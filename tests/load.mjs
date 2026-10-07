// Load test: N bot players submit at nearly the same time and poll like the browser does.
// Phase A: mock grader, no quota pressure. Phase B: mock grader with rpm_limit=12 per model (real-world ceiling),
// which forces queueing. Asserts every prompt is graded, nobody waits past the 90 s fallback, and the board is consistent.
// Run: BOTS=40 npm run test:load, or BOTS=12 RPM=3 to see queueing and the estimate fallback with fewer bots.
// Supabase allows 30 anonymous sign-ins per hour per IP by default, so raise
// Authentication > Rate Limits > anonymous sign-ins before a 40-bot run.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY, pass = process.env.ADMIN_PASSPHRASE;
const BOTS = Number(process.env.BOTS ?? 40);
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 5000);
// Phase B per-model ceiling. 12 is the production value; with few bots use e.g. RPM=3 to force queueing.
const RPM = Number(process.env.RPM ?? 12);
const tag = Math.random().toString(36).slice(2, 6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const must = async (p) => {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
};

const admin = client();
await must(admin.auth.signInAnonymously());
await must(admin.rpc("register_player", { nickname: `Load admin ${tag}` }));
await must(admin.rpc("claim_admin", { passphrase: pass }));
const before = (await must(admin.rpc("admin_stats"))).settings;

const bots = [];
for (let i = 0; i < BOTS; i++) {
  const c = client();
  await must(c.auth.signInAnonymously());
  const r = await must(c.rpc("register_player", { nickname: `Bot ${tag} ${i}` }));
  bots.push({ c, id: r.player.id, name: r.player.nickname });
}
console.log(`${BOTS} bots registered`);

// Browser-like loop: poll grade_status every ~2.5 s, re-invoke grade-prompt every 6 s while not graded.
async function play(bot, scenario) {
  await sleep(Math.random() * WINDOW_MS);
  const t0 = Date.now();
  const s = await must(bot.c.rpc("submit_prompt", {
    scenario_id: scenario,
    prompt: `You are a tutor. Bot ${bot.name} needs a study plan with 10 flashcards and a 5 question quiz. Only use my notes.`,
  }));
  let lastKick = 0, status;
  while (true) {
    if (Date.now() - lastKick > 6000) {
      lastKick = Date.now();
      await bot.c.functions.invoke("grade-prompt", { body: { submission_id: s.submission_id } });
    }
    status = await must(bot.c.rpc("grade_status", { submission_id: s.submission_id }));
    if (status.status === "graded") break;
    if (Date.now() - t0 > 150_000) throw new Error("bot waited over 150 s");
    await sleep(2500 + Math.random() * 600);
  }
  return { wait: Date.now() - t0, by: status.graded_by, percent: status.percent };
}

async function phase(label, scenario, settings) {
  for (const [k, v] of Object.entries(settings)) await must(admin.rpc("admin_set_setting", { key: k, value: v }));
  const t = Date.now();
  const results = await Promise.all(bots.map((b) => play(b, scenario)));
  const waits = results.map((r) => r.wait).sort((a, b) => a - b);
  const by = results.reduce((m, r) => ((m[r.by] = (m[r.by] ?? 0) + 1), m), {});
  console.log(`${label}: ${results.length} graded in ${((Date.now() - t) / 1000).toFixed(1)} s; wait p50 ${(waits[waits.length >> 1] / 1000).toFixed(1)} s, max ${(waits.at(-1) / 1000).toFixed(1)} s; graded_by ${JSON.stringify(by)}`);
  assert.equal(results.length, BOTS);
  assert.ok(waits.at(-1) <= 100_000, "no player waits much past the 90 s estimate fallback");
  return results;
}

try {
  // Wait out the last minute of mock calls so phase B starts with an empty per-minute window.
  const a = await phase("Phase A (mock, no quota pressure)", 1, { grader_mode: "mock", rpm_limit: 1000, queue_timeout_s: 90 });
  assert.ok(a.every((r) => r.by === "mock"));
  console.log("Waiting 61 s for the per-minute window to clear...");
  await sleep(61_000);
  const b = await phase(`Phase B (mock, rpm_limit=${RPM} per model)`, 2, { grader_mode: "mock", rpm_limit: RPM, queue_timeout_s: 90 });
  const mock = b.filter((r) => r.by === "mock").length;
  assert.ok(mock >= Math.min(BOTS, 2 * RPM), `at least one minute of capacity (${2 * RPM}) graded by the model path, got ${mock}`);

  const board = await must(bots[0].c.rpc("leaderboard", {}));
  const rows = [...board.ranked, ...board.in_progress].filter((r) => r.nickname.startsWith(`Bot ${tag}`));
  assert.equal(rows.length, BOTS, "every bot appears exactly once on the board");
  for (const r of rows) assert.equal(r.scores.filter((v) => v != null).length, 2, "two scenarios scored per bot");
  console.log("Load test passed.");
} finally {
  for (const k of ["grader_mode", "rpm_limit", "queue_timeout_s"]) await admin.rpc("admin_set_setting", { key: k, value: before[k] });
  for (const b of bots) await admin.rpc("admin_remove_player", { player_id: b.id });
  console.log("Cleanup: settings restored, bots removed.");
}
