# 2026-10-07: v1 build (phases 1–8 of PLAN.md section 9)

**Scaffold.** Git repo, configs copied from imposter-llm (`vite.config.ts` env guard, `vercel.json` CSP plus SPA rewrites and `img-src blob:`, `.gitignore`, secret scan extended with Google API key and bcrypt patterns). Added `scripts/check-dist.mjs` (postbuild): fails if the bundle contains a Google key, a service-role reference, a Supabase secret key, or grader notes.

**Scoring port.** `shared/scoring.ts` ports the prototype's PURE block unchanged (`finalize` caps, the percent formula, `localGrade`, `STRENGTH`/`FIX`, `summaryData`). `localGrade` takes the `must` pattern strings. Added the grader prompt split into a system instruction (rules plus calibration anchor) and user content (scenario plus fenced student prompt), a JSON schema, and a deterministic `mockGrade`. `shared/scenarios.ts` is extracted programmatically from the reference `SCEN`. A unit test re-reads the HTML and asserts byte equality. 14 unit tests pass.

**Supabase.** New project `core-prompt-challenge` (ref `rndukbzegenpextindwd`, us-east-2, free org "Chow", $0/month confirmed; PropWholesaler stays paused). Nine migrations: schema; seed (generated); identity RPCs; play RPCs; rooms; grader service functions; admin; grader helpers; pg_cron drain plus nightly cleanup. Security advisors report only the expected INFO "RLS enabled, no policy" on private tables.

Deviations from the plan, with reasons:
- **Admin passphrase is a bcrypt hash in `game_private.secrets` and checked in SQL** (`claim_admin` RPC, rate-limited 5/h), not an `ADMIN_PASSPHRASE` function secret behind an `admin` Edge Function. The Supabase CLI is not logged in on this machine and the MCP cannot set function secrets. This keeps the passphrase out of every log and needs no extra function. The plaintext was generated locally into `.env.local` (git-ignored) and only the hash was sent.
- **Drain token lives in Vault** (generated inside the DB, read by pg_cron and checked by `svc_check_drain_token`) instead of a `DRAIN_TOKEN` function secret, for the same reason.
- **`play_open` and the solo caps apply to solo play only.** Live rooms are already gated by admins, and blocking a member at a meeting because they used their solo tries would be wrong. Live submissions still count toward the season best-of. The solo 3-try cap counts solo attempts only.
- **Per-IP limit counts distinct submissions** (30/h, solo plus Gemini mode only). The browser re-invokes the grader every 6 s for the same submission, and campus NAT would otherwise lock out a room.
- Regrade keeps the estimate visible until the real grade lands (`regrade_requested` flag, not a status reset), so boards never flicker.
- Nickname filter: substring list for slurs plus a whole-word list, so names like "Hancock" or "Grape" are allowed (tested).

**Edge Functions.** `grade-prompt` (JWT verified, ownership checked via `auth.getUser`, 8 KB body cap) and `drain-queue` (Vault token), sharing `_shared/worker.ts`. Type-checked with `deno check`. Without `GEMINI_API_KEY` both fall back to estimates, verified live.

**Tests.**
- `tests/scoring.sql` (rolled-back fixtures): tie-break, best-of-three, in-progress list, prompt privacy, room lifecycle, double-claim, per-minute quota, season rollover. Pass.
- `tests/integration.mjs` (live, mock mode): registration rules, recovery to a new device, admin gating, hidden tables and `svc_*`, the 3-try cap, queueing over quota with the 5 s timeout estimate, pg_cron regrade replacing the estimate, the room happy path and negatives, board privacy. Pass on the first run; cleans up after itself.
- `tests/load.mjs`: 14 bots (limited by Supabase's 30 anonymous sign-ins per hour per IP). Phase A: max wait 0.8 s; phase B (rpm 12): max 1.4 s, all graded, board consistent. A 40-bot run needs the auth rate limit raised first. `RPM=3` forces queueing with fewer bots.
- `tests/calibration.mjs`: written, not yet run (needs `GEMINI_API_KEY` in `.env.local`).

**Frontend.** React 19, path routing (Vercel rewrites), and the prototype's look ported 1:1 (palette, Georgia, panels, CORE cards, score cards, result card, summary table, copy). Host stage follows imposter-llm's Kahoot-style direction: maroon field, giant code plus a 400 px QR (bundled `qrcode`, no CDN), big scenario and timer, live board, podium, fixed bottom bar. Host and Admin are lazy-loaded. Verified in the browser pane at 360, 375, 1024 and 1920 px: solo register → recovery dialog → grade → result; host create → bot join appears live → start → timer and submitted count → finish → podium; second-origin phone player joins and follows the host over Realtime. Consoles were clean. Fixes from that pass:
- `/play` now pins `?s=N` so a finished scenario shows its result instead of jumping ahead.
- Join code sized with a container query.
- Lining numerals for codes, timers and scores (Georgia defaults to old-style).
- Stage cards stack below 1280 px.
- Podium width capped.

**Open items for Caio.**
1. Set the `GEMINI_API_KEY` function secret, then run `npm run test:calibration` and record the results.
2. Raise the anonymous sign-in rate limit.
3. Push to GitHub and import into Vercel.
4. Dress rehearsal on the public URL.
5. Vault updates (PLAN 9.11) once the site is live.
