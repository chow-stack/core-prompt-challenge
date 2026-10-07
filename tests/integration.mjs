// Live integration test against the linked Supabase project (style of imposter-llm/tests/integration.mjs).
// Run: npm run test:integration
// .env.local needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, plus SUPABASE_SECRET_KEY (Dashboard -> Settings ->
// API keys -> secret key; test-only, never in a VITE_ variable) so the test can switch the grader to mock mode and burn
// no Gemini quota. Without the secret key, set grader_mode to "mock" in the SQL editor first; the quota section is skipped.
// Every test player deletes itself at the end.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
assert.ok(url && key, "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local");

const tag = Math.random().toString(36).slice(2, 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = (k = key) => createClient(url, k, { auth: { persistSession: false, autoRefreshToken: false } });
const svc = secret ? client(secret) : null;
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
}
async function grade(c, id) {
  const { data, error } = await c.functions.invoke("grade-prompt", { body: { submission_id: id } });
  assert.equal(error, null, error?.message);
  return data;
}
const setSetting = (k, v) => ok(svc, "svc_set_setting", { key: k, value: v });

const players = Array.from({ length: 5 }, () => client());
const [host, p1, p2, p3, outsider] = players;
for (const c of players) {
  const { error } = await c.auth.signInAnonymously();
  assert.equal(error, null, error?.message);
}
let restore = null;

try {
  if (svc) {
    restore = { grader_mode: "gemini", rpm_limit: 12, queue_timeout_s: 90 };
    await setSetting("grader_mode", "mock");
  } else console.log("  (no SUPABASE_SECRET_KEY: assuming grader_mode is already 'mock'; quota section skipped)");

  step("registration and nickname rules");
  await denied(p1, "register_player", { nickname: "   " }, /Enter a nickname/);
  await denied(p1, "register_player", { nickname: "x".repeat(21) }, /at most 20/);
  await denied(p1, "register_player", { nickname: "f.u.c.k " + tag }, /different nickname/);
  const r1 = await ok(p1, "register_player", { nickname: `IT One​ ${tag}` });
  assert.equal(r1.player.nickname, `IT One ${tag}`, "zero-width characters are stripped");
  assert.equal(r1.recovery_code, undefined, "recovery codes are gone");
  await denied(p1, "register_player", { nickname: "Second " + tag }, /already has a player/);
  await denied(p2, "register_player", { nickname: `it one ${tag}` }, /taken/);
  for (const [c, n] of [[p2, `Hancock ${tag}`], [p3, `Grape ${tag}`], [outsider, `IT Out ${tag}`], [host, `IT Host ${tag}`]]) {
    await ok(c, "register_player", { nickname: n });
  }
  await denied(p1, "recover_player", { nickname: "x", code: "y" }); // removed
  await denied(p1, "claim_admin", { passphrase: "x" }); // removed

  step("hidden data");
  const scen = await ok(p2, "list_scenarios");
  assert.equal(scen.length, 6);
  assert.deepEqual(scen.slice(3).map((s) => s.title), ["Dorm-room chef", "Spring break road trip", "Haunted campus adventure"]);
  assert.ok(!JSON.stringify(scen).includes("Strong prompt"), "grader notes never leave the DB");
  for (const t of ["submissions", "players", "scenarios", "grader_calls"]) {
    const { error } = await p2.schema("game_private").from(t).select("*").limit(1);
    assert.ok(error, `game_private.${t} must not be readable`);
  }
  await denied(p2, "svc_load", { sub: "00000000-0000-0000-0000-000000000000" }, /permission denied/);
  await denied(p2, "svc_set_setting", { key: "grader_mode", value: "mock" }, /permission denied/);

  step("solo: exactly one try per scenario");
  const prompt = "You are a tutor. My Econ midterm is Thursday. Build an interactive site with 30 flashcards and a 15 question quiz.";
  const s1 = await ok(p2, "submit_prompt", { scenario_id: 1, prompt });
  await denied(p2, "submit_prompt", { scenario_id: 1, prompt: prompt + " again" }, /already submitted/);
  // Moving on while grading: a second scenario can be submitted before the first is graded.
  const s2 = await ok(p2, "submit_prompt", { scenario_id: 4, prompt: "Give me a microwave mug recipe with eggs and cheese in under 10 minutes. Only use what I have." });
  const prog0 = await ok(p2, "my_progress");
  assert.equal(prog0.scenarios[0].attempts_left, 0);
  assert.equal(prog0.scenarios[0].latest.status, "queued");
  for (const id of [s1.submission_id, s2.submission_id]) assert.equal((await grade(p2, id)).status, "graded");
  const st = await ok(p2, "grade_status", { submission_id: s1.submission_id });
  assert.equal(st.graded_by, "mock");
  await denied(p3, "grade_status", { submission_id: s1.submission_id }, /not found/);
  const other = await p3.functions.invoke("grade-prompt", { body: { submission_id: s1.submission_id } });
  assert.ok(other.error, "grading someone else's submission is refused");
  await denied(p2, "submit_prompt", { scenario_id: 2, prompt: "x".repeat(1501) }, /1500/);

  if (svc) {
    step("quota: queued over the per-minute ceiling, then estimate after the timeout");
    await setSetting("rpm_limit", 1); // the two mock calls above fill both models for this minute
    await setSetting("queue_timeout_s", 5);
    const q = await ok(p3, "submit_prompt", { scenario_id: 2, prompt: "Act as a tough recruiter for my marketing internship. Ask 5 behavioral questions one at a time." });
    assert.equal((await grade(p3, q.submission_id)).status, "queued");
    await sleep(6500);
    assert.equal((await grade(p3, q.submission_id)).detail, "estimate_timeout");
    assert.equal((await ok(p3, "grade_status", { submission_id: q.submission_id })).is_estimate, true);
    await setSetting("rpm_limit", 12);
    await setSetting("queue_timeout_s", 90);
  }

  step("live room: any player can host; join, late join, one try, room board, host-only controls");
  const room = await ok(host, "game_create", { timer_seconds: 120 });
  const gid = room.game.id;
  assert.equal(room.role, "host");
  assert.equal((await ok(host, "my_hosted_game")).id, gid);
  await denied(outsider, "game_state", { game_id: gid }, /not found/);
  const { data: visible } = await outsider.from("games").select("id").eq("id", gid);
  assert.equal(visible.length, 0, "non-members cannot read the room row");
  await ok(p1, "game_join", { code: room.game.code.toLowerCase() });
  await ok(p2, "game_join", { code: room.game.code });
  await denied(p2, "game_join", { code: "ZZ1" }, /4-letter/);
  await denied(p2, "submit_prompt", { scenario_id: 1, prompt: "early", game_id: gid }, /not open/);
  await denied(p2, "game_advance", { game_id: gid }, /Only the host/);
  let gs = await ok(host, "game_advance", { game_id: gid });
  assert.equal(gs.scenario.position, 0);
  await ok(p3, "game_join", { code: room.game.code }); // late joiner
  const live = await ok(p1, "submit_prompt", { scenario_id: 1, prompt: prompt + " Live.", game_id: gid });
  await denied(p1, "submit_prompt", { scenario_id: 1, prompt: "again", game_id: gid }, /already submitted/);
  await denied(outsider, "submit_prompt", { scenario_id: 1, prompt: "sneaky", game_id: gid }, /Join the game/);
  // p2 already used its solo try on scenario 1 but can still play it live.
  const live2 = await ok(p2, "submit_prompt", { scenario_id: 1, prompt: prompt + " Live two.", game_id: gid });
  // The host can move on while grading is still running.
  gs = await ok(host, "game_advance", { game_id: gid });
  assert.equal(gs.scenario.position, 1);
  assert.equal((await grade(p1, live.submission_id)).status, "graded");
  assert.equal((await grade(p2, live2.submission_id)).status, "graded");
  gs = await ok(host, "game_state", { game_id: gid });
  assert.equal(gs.player_count, 3);
  assert.ok(!JSON.stringify(gs).includes("Live two"), "room state never includes prompt text");
  const rb = await ok(p3, "leaderboard", { game_id: gid });
  assert.equal(rb.ranked.length, 3);
  assert.ok(rb.ranked[0].total >= rb.ranked[1].total);
  await denied(outsider, "leaderboard", { game_id: gid }, /Join the game/);
  const room2 = await ok(host, "game_create", { timer_seconds: 60 });
  assert.equal((await ok(p1, "game_state", { game_id: gid })).game.phase, "finished", "a new room ends the host's previous one");
  await ok(host, "game_end", { game_id: room2.game.id });

  step("season board never shows prompts and highlights me");
  const board = await ok(p2, "leaderboard");
  assert.ok(!JSON.stringify(board).includes("tutor"));
  const mine = [...board.ranked, ...board.in_progress].find((r) => r.is_me);
  assert.ok(mine && mine.scores.length === 6);

  console.log("\nAll integration checks passed.");
} finally {
  if (restore) for (const [k, v] of Object.entries(restore)) await svc.rpc("svc_set_setting", { key: k, value: v });
  for (const c of players) await c.rpc("delete_me");
  console.log("Cleanup: test players deleted" + (restore ? ", settings restored." : "."));
}
