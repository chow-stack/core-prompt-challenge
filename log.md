# 2026-10-07 (evening): Caio's scenario set

- Scenarios 4–6 are now The fridge note, Treaty with the campus squirrel, and McNutt plate strategy (Caio's text, verbatim). Hidden grader notes and keyword patterns were written for each. Scenarios 1–3 are unchanged. Applied live as migration `20261008000300_new_fun_scenarios.sql` (generated from `shared/scenarios.ts`). No submissions existed for the old 4–6.
- The home tagline now reads "from exam prep to negotiating with a campus squirrel."
- Friendly "Could not connect" message instead of a raw "TypeError: Failed to fetch"; leaderboard estimate note updated.

# 2026-10-07 (later): one try, background grading, open hosting, fun scenarios

Changes Caio requested after the first deploy:

- **One try per scenario** (solo). `submit_prompt` rejects a second solo submission; `player_daily_cap` is now 6. Live rooms were already one per room. "Try again" is gone from the UI.
- **Move on while grading.** A new app-level grading tracker (`src/state.tsx`) polls every in-flight submission and nudges the grader. It survives navigation and reloads (localStorage) and raises a "Scenario N graded: 84%" toast. After submitting, solo jumps straight to the next unplayed scenario. Pips show a pulsing "..." while grading, with a banner that says "Grading N prompts in the background". The results page lists pending rows as "Grading..." and fills in live. In live rooms the player sees "Submitted! Your prompt is being graded", and grading continues if the host advances.
- **Recovery codes removed**: RPCs, `recovery_hash` column, and UI.
- **Admin and passphrase removed**: `/admin`, `claim_admin`, the `admin_*` RPCs, `is_admin`, and the `secrets` table. Any player can host. "Hosting?" is always on Home, Host is in the header nav, a new room ends the host's previous one, and `my_hosted_game` powers "Resume game". Settings are edited in the SQL editor (README). Tests use a service-role-only `svc_set_setting` with `SUPABASE_SECRET_KEY` from `.env.local`; `delete_me` lets test players clean up.
- **Scenarios 4–6 replaced** with Dorm-room chef, Spring break road trip, and Haunted campus adventure (1–3 unchanged). The seed generator gained `--scenarios-only`. A unit test checks that a strong prompt beats a vague one by 40+ points on each of them.
- Fix: `auth()` re-checks the session on every call and RPCs retry once with a fresh anonymous session on auth errors, so a cleared or expired session no longer leaves the page stuck on "Something went wrong".
- Verified with real Gemini: solo through all six (submit → next scenario within 0.5 s → toast about 2–4 s later; the summary filled in live), host without passphrase, a phone player joined and submitted live. Integration (mock), SQL fixtures, and 15 unit tests pass.

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
