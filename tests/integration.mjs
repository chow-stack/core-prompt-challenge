// Live integration test against the linked Supabase project (style of imposter-llm/tests/integration.mjs).
// Run: npm run test:integration   (needs .env.local with VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, ADMIN_PASSPHRASE)
// Uses grader_mode='mock' so it burns no Gemini quota, and restores settings and removes its players at the end.
// Season rollover is covered by tests/scoring.sql (inside a rolled-back transaction) so the real board is never archived.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const pass = process.env.ADMIN_PASSPHRASE;
assert.ok(url && key && pass, "Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and ADMIN_PASSPHRASE in .env.local");

const tag = Math.random().toString(36).slice(2, 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const step = (name) => console.log("•", name);

async function ok(c, fn, args = {}) {
  const { data, error } = await c.rpc(fn, args);
  assert.equal(error, null, `${fn} failed: ${error?.message}`);
  return data;
}
async function denied(c, fn, args, pattern) {
  const { error } = await c.rpc(fn, args);
  assert.ok(error, `${fn} must be denied`);
  if (pattern) assert.match(error.message, pattern, `${fn}: unexpected error "${error.message}"`);
  return error.message;
}
async function grade(c, id) {
  const { data, error } = await c.functions.invoke("grade-prompt", { body: { submission_id: id } });
  assert.equal(error, null, error?.message);
  return data;
}

const [admin, p1, p2, p3, outsider, device2] = Array.from({ length: 6 }, client);
for (const c of [admin, p1, p2, p3, outsider, device2]) {
  const { error } = await c.auth.signInAnonymously();
  assert.equal(error, null, error?.message);
}
const playerIds = [];
let restore = null;

try {
  step("registration and nickname rules");
  await denied(p1, "register_player", { nickname: "   " }, /Enter a nickname/);
  await denied(p1, "register_player", { nickname: "x".repeat(21) }, /at most 20/);
  await denied(p1, "register_player", { nickname: "f.u.c.k " + tag }, /different nickname/);
  const r1 = await ok(p1, "register_player", { nickname: `IT One​ ${tag}` });
  assert.equal(r1.player.nickname, `IT One ${tag}`, "zero-width characters are stripped");
  assert.match(r1.recovery_code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  playerIds.push(r1.player.id);
  await denied(p1, "register_player", { nickname: "Second " + tag }, /already has a player/);
  await denied(p2, "register_player", { nickname: `it one ${tag}` }, /taken/);
  // Whole-word list must not block innocent names.
  for (const [c, n] of [[p2, `Hancock ${tag}`], [p3, `Grape ${tag}`], [outsider, `IT Out ${tag}`]]) {
    playerIds.push((await ok(c, "register_player", { nickname: n })).player.id);
  }

  step("recovery code moves a player to a new device");
  await denied(device2, "recover_player", { nickname: `IT One ${tag}`, code: "AAAA-AAAA" }, /do not match/);
  const rec = await ok(device2, "recover_player", { nickname: `it one ${tag}`, code: r1.recovery_code.toLowerCase().replace("-", "") });
  assert.equal(rec.id, r1.player.id);
  assert.equal(await ok(p1, "me"), null, "old device no longer owns the player");
  const p1b = device2; // p1 now plays from device2

  step("admin gating");
  await denied(p2, "game_create", { timer_seconds: 120 }, /club leaders/);
  await denied(p2, "admin_stats", {}, /club leaders/);
  await ok(admin, "register_player", { nickname: `IT Admin ${tag}` });
  await denied(admin, "claim_admin", { passphrase: "wrong passphrase" }, /not right/);
  assert.equal((await ok(admin, "claim_admin", { passphrase: pass })).is_admin, true);
  const before = (await ok(admin, "admin_stats")).settings;
  restore = { grader_mode: before.grader_mode, rpm_limit: before.rpm_limit, queue_timeout_s: before.queue_timeout_s };
  await ok(admin, "admin_set_setting", { key: "grader_mode", value: "mock" });
  await denied(admin, "admin_set_setting", { key: "grader_mode", value: "chaos" }, /Mode must be/);
  await denied(admin, "admin_set_setting", { key: "secret_stuff", value: 1 }, /Unknown setting/);

  step("hidden data");
  const scen = await ok(p2, "list_scenarios");
  assert.equal(scen.length, 6);
  assert.ok(!JSON.stringify(scen).includes("Strong prompt"), "grader notes never leave the DB");
  for (const t of ["submissions", "players", "scenarios", "grader_calls"]) {
    const { error } = await p2.schema("game_private").from(t).select("*").limit(1);
    assert.ok(error, `game_private.${t} must not be readable`);
  }
  await denied(p2, "svc_load", { sub: "00000000-0000-0000-0000-000000000000" }, /permission denied/);
  await denied(p2, "svc_record", { sub: "00000000-0000-0000-0000-000000000000", call_id: null, grade: {} }, /permission denied/);

  step("solo: submit, grade (mock), best-of-three cap");
  const prompt = "You are a tutor. My Econ midterm is Thursday. Build an interactive site with 30 flashcards and a 15 question quiz.";
  let last;
  for (let i = 1; i <= 3; i++) {
    const s = await ok(p2, "submit_prompt", { scenario_id: 1, prompt: prompt + " Try " + i });
    const g = await grade(p2, s.submission_id);
    assert.equal(g.status, "graded", JSON.stringify(g));
    last = s.submission_id;
  }
  await denied(p2, "submit_prompt", { scenario_id: 1, prompt }, /all 3 tries/);
  const st = await ok(p2, "grade_status", { submission_id: last });
  assert.equal(st.graded_by, "mock");
  assert.ok(st.percent >= 0 && st.percent <= 100);
  await denied(p3, "grade_status", { submission_id: last }, /not found/);
  const other = await p3.functions.invoke("grade-prompt", { body: { submission_id: last } });
  assert.ok(other.error, "grading someone else's submission is refused");
  await denied(p2, "submit_prompt", { scenario_id: 2, prompt: "x".repeat(1501) }, /1500/);
  const prog = await ok(p2, "my_progress");
  assert.equal(prog.scenarios[0].attempts_left, 0);
  assert.ok(prog.scenarios[0].best.percent >= 0);

  step("quota: queued while over the per-minute ceiling, then estimate after the timeout");
  await ok(admin, "admin_set_setting", { key: "rpm_limit", value: 1 }); // the three mock calls above fill both models
  await ok(admin, "admin_set_setting", { key: "queue_timeout_s", value: 5 });
  const q = await ok(p3, "submit_prompt", { scenario_id: 2, prompt: "Act as a tough recruiter for my marketing internship. Ask 5 behavioral questions one at a time and grade each answer with STAR." });
  const g1 = await grade(p3, q.submission_id);
  assert.equal(g1.status, "queued", "over quota must queue: " + JSON.stringify(g1));
  assert.equal((await ok(p3, "grade_status", { submission_id: q.submission_id })).status, "queued");
  await sleep(6500);
  const g2 = await grade(p3, q.submission_id);
  assert.equal(g2.detail, "estimate_timeout", JSON.stringify(g2));
  const est = await ok(p3, "grade_status", { submission_id: q.submission_id });
  assert.equal(est.is_estimate, true);
  assert.equal(est.graded_by, "estimate");

  step("regrade estimates (cron backstop replaces the estimate)");
  await ok(admin, "admin_set_setting", { key: "rpm_limit", value: before.rpm_limit });
  await ok(admin, "admin_set_setting", { key: "queue_timeout_s", value: before.queue_timeout_s });
  const rg = await ok(admin, "admin_regrade_estimates");
  assert.ok(rg.requeued >= 1);
  // The estimate still counts while waiting.
  assert.equal((await ok(p3, "grade_status", { submission_id: q.submission_id })).status, "graded");
  let regraded = false;
  for (let i = 0; i < 30 && !regraded; i++) {
    await sleep(5000);
    const s = await ok(p3, "grade_status", { submission_id: q.submission_id });
    regraded = !s.is_estimate && s.graded_by === "mock";
  }
  assert.ok(regraded, "pg_cron drain-queue should regrade within ~2 minutes");

  step("live room: join, late join, one try, room board, host-only controls");
  const room = await ok(admin, "game_create", { timer_seconds: 120 });
  const gid = room.game.id;
  assert.equal(room.role, "host");
  await denied(outsider, "game_state", { game_id: gid }, /not found/);
  const { data: visible } = await outsider.from("games").select("id").eq("id", gid);
  assert.equal(visible.length, 0, "non-members cannot read the room row");
  await ok(p1b, "game_join", { code: room.game.code.toLowerCase() });
  await ok(p2, "game_join", { code: room.game.code });
  await denied(p2, "game_join", { code: "ZZ1" }, /4-letter/);
  await denied(p2, "submit_prompt", { scenario_id: 1, prompt: "early", game_id: gid }, /not open/);
  await denied(p2, "game_advance", { game_id: gid }, /Only the host/);
  let gs = await ok(admin, "game_advance", { game_id: gid });
  assert.equal(gs.scenario.position, 0);
  await ok(p3, "game_join", { code: room.game.code }); // late joiner
  const live = await ok(p1b, "submit_prompt", { scenario_id: 1, prompt: prompt + " Live.", game_id: gid });
  await denied(p1b, "submit_prompt", { scenario_id: 1, prompt: "again", game_id: gid }, /already submitted/);
  await denied(p1b, "submit_prompt", { scenario_id: 2, prompt: "wrong one", game_id: gid }, /not open/);
  await denied(outsider, "submit_prompt", { scenario_id: 1, prompt: "sneaky", game_id: gid }, /Join the game/);
  // p2 used all 3 solo tries on scenario 1 but can still play it live.
  const live2 = await ok(p2, "submit_prompt", { scenario_id: 1, prompt: prompt + " Live two.", game_id: gid });
  assert.equal((await grade(p1b, live.submission_id)).status, "graded");
  assert.equal((await grade(p2, live2.submission_id)).status, "graded");
  gs = await ok(admin, "game_state", { game_id: gid });
  assert.equal(gs.player_count, 3);
  assert.equal(gs.submitted, 2);
  assert.ok(!JSON.stringify(gs).includes("Live two"), "room state never includes prompt text");
  const rb = await ok(p3, "leaderboard", { game_id: gid });
  assert.equal(rb.ranked.length, 3);
  assert.ok(rb.ranked[0].total >= rb.ranked[1].total);
  assert.ok(!JSON.stringify(rb).includes("prompt"));
  await denied(outsider, "leaderboard", { game_id: gid }, /Join the game/);
  for (let i = 1; i < 6; i++) gs = await ok(admin, "game_advance", { game_id: gid });
  gs = await ok(admin, "game_advance", { game_id: gid });
  assert.equal(gs.game.phase, "finished");
  await denied(p3, "submit_prompt", { scenario_id: 6, prompt: "after the end", game_id: gid }, /not open/);

  step("season board never shows prompts and highlights me");
  const board = await ok(p2, "leaderboard");
  assert.ok(!JSON.stringify(board).includes("tutor"));
  const mine = [...board.ranked, ...board.in_progress].find((r) => r.is_me);
  assert.ok(mine, "my row is marked is_me");
  assert.equal(mine.scores.length, 6);

  console.log("\nAll integration checks passed.");
} finally {
  // Restore grader settings and remove test players (submissions cascade) so the real board stays clean.
  if (restore) {
    for (const [k, v] of Object.entries(restore)) await admin.rpc("admin_set_setting", { key: k, value: v });
    for (const id of playerIds) await admin.rpc("admin_remove_player", { player_id: id });
    console.log("Cleanup: settings restored, test players removed. The test admin (no scores) stays; remove it in Admin if you like.");
  }
}
