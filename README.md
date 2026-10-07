# The CORE Prompt Challenge

A Gen AI Club (Indiana University) activity, played at club meetings. Members write prompts for six scenarios (three school, three just for fun) and get graded on **CORE**: **C**ontext, **O**utput, **R**ules, **E**xamples. Scores go on a season leaderboard, and club leaders can run live rooms at meetings with a join code, a QR code, and a projector view.

Scenarios, scoring math, grader prompt, copy, and palette come from the original prototype in [`reference/artifact-original.html`](reference/artifact-original.html). The full design is in [`PLAN.md`](PLAN.md).

## How it works

| Mode | Who | Rules |
|---|---|---|
| **Solo (season)** | Anyone with the link | **One graded try per scenario.** After submitting, the player moves straight on to the next scenario while Gemini grades in the background; scores pop up as toasts and fill in the scenario pips. Season score = sum of the six scores (max 600). Only players with all six scored are ranked; tie-break is earlier completion. |
| **Live room** | Anyone can host (Home → Hosting? or the Host link), anyone joins | One try per scenario per room, on a timer the host sets. Grading continues in the background if the host moves on. Live scores also count toward the season board (best score per scenario). Hosts spectate. |

- **Identity:** nickname + Supabase anonymous auth, tied to the browser. Players can rename (3/day) from the home page. There are no accounts, recovery codes, or admin roles: the game is played inside club meetings.
- **Privacy:** players see only their own prompts. Boards show scores, never prompt text. Prompts are graded by Google Gemini's **free tier, which Google may use to improve its products**. The compose screen says "Don't put personal info in your prompt." The only personal data collected is a nickname.
- **Estimates:** when the AI grader is unavailable, a keyword estimate (the prototype's `localGrade`) is used and shown with `~`. They count on the board.

## Architecture

```
Browser (React 19 + Vite, Vercel)  ──RPC──▶  Supabase Postgres (RLS, game_private schema, security-definer functions)
        │                                         ▲
        └─invoke grade-prompt (JWT)──▶ Edge Function ──svc_* (service role)──┘
                                           │
                                           └──▶ Gemini generateContent (REST, key in function secret)
pg_cron (every minute) ──▶ drain-queue Edge Function (Vault token)   # backstop for queued prompts and regrades
```

- `shared/scoring.ts`: pure scoring ported from the prototype (`finalize`, `localGrade`, `summaryData`, grader prompt builders). Imported by Node tests, the Edge Functions (copied to `supabase/functions/_shared/` by `scripts/sync-shared.mjs`), and the browser (display parts only).
- `shared/scenarios.ts`: the six scenarios, extracted verbatim from the prototype. Server-only; the seed migration is generated from it (`scripts/gen-seed.mjs`). Grader notes and `must` patterns never reach the browser (enforced by `scripts/check-dist.mjs`).
- `supabase/migrations/`: schema, seed, and RPCs. Public RPCs are thin `security invoker` wrappers over `game_private.*` `security definer` functions with `search_path = ''`. Private tables have RLS on and no client grants. `svc_*` functions are executable by `service_role` only.
- `supabase/functions/grade-prompt`: grades the caller's own submission (JWT required). `drain-queue`: cron backstop, authorized by a token stored in Vault.
- `src/`: React app. Screens: Home, Solo, Board, Live (player), Host (projector stage). `src/state.tsx` holds the background grading tracker (polls every in-flight submission, nudges the grader, survives reloads via localStorage, raises "score is in" toasts).

### Gemini quota design (free tier: 15 RPM and 500 RPD per model; RPD resets at midnight Pacific)

The app uses safety margins stored in `game_private.app_settings` (edit them in the Supabase SQL editor, e.g. `update game_private.app_settings set value = '"estimate"' where key = 'grader_mode';`):

| Setting | Default | Meaning |
|---|---|---|
| `rpm_limit` | 12 | Calls per minute per model |
| `rpd_limit` | 450 | Calls per day per model |
| `solo_daily_cap` | 550 | Total daily calls for solo play (reserves about 350 for live rooms) |
| `player_daily_cap` | 6 | Solo prompts per player per day |
| `queue_timeout_s` | 90 | Seconds in line before a quick estimate |
| `models` | `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` | Primary, secondary |
| `grader_mode` | `gemini` | `gemini`, `estimate` (never call Gemini), or `mock` (load tests) |

Flow: submission inserted as `queued` → `svc_claim` takes an advisory lock and picks the model with spare minute and day capacity (fewest calls in the last 60 s), recording a ledger row in `grader_calls` → Gemini call (12 s timeout) → result clamped by `finalize()` → `svc_record`. On a 429, 5xx, timeout, bad JSON, or safety block, it tries the other model once, then requeues with a 5 / 15 / 45 s backoff. The browser polls `grade_status` every ~2.5 s and re-invokes the function every 6 s while queued, and pg_cron drains the queue every minute. After 90 s, 3 failed tries, the daily ceiling, or with no API key, the prompt gets an estimate. A per-IP limit of 30 distinct solo prompts per hour applies.

## Run locally

```bash
npm install
```

Create `.env.local` (git-ignored) with:

```
VITE_SUPABASE_URL=https://rndukbzegenpextindwd.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=...     # test-only: lets integration/load tests switch the grader to mock mode
GEMINI_API_KEY=...          # only for tests/calibration.mjs
```

```bash
npm run dev
```

| Command | What it does |
|---|---|
| `npm test` | Unit tests for the scoring port (Node type stripping, no build) |
| `npm run build` | Secret scan → type check → Vite build → dist leak check |
| `npm run test:integration` | Live end-to-end checks against Supabase (mock grader, cleans up after itself) |
| `npm run test:load` | `BOTS=40` bots submitting at once (mock grader). Add `RPM=3` to force queueing with fewer bots |
| `npm run test:calibration` | Grades 12 prompts plus an injection test on both Gemini models and writes `tests/calibration-results.md` |
| `tests/scoring.sql` | Transactional ranking, tie-break, rooms, quota, and rollover fixtures. Paste into the SQL editor; it rolls back |

Scenarios 1–3 come verbatim from the prototype; 4–6 (The fridge note, Treaty with the campus squirrel, McNutt plate strategy) are the fun set. To change scenarios, edit `shared/scenarios.ts` and run `node scripts/gen-seed.mjs --scenarios-only` into a new migration.

After editing `shared/scoring.ts`, run `node scripts/sync-shared.mjs` and redeploy the functions. After editing `shared/scenarios.ts`, run `node scripts/gen-seed.mjs` into a **new** migration.

## Deploy

**Supabase** (project `core-prompt-challenge`, ref `rndukbzegenpextindwd`, us-east-2, free plan): migrations and both Edge Functions are already applied. Still needed in the dashboard:

1. **Gemini key:** Edge Functions → Secrets → add `GEMINI_API_KEY` (create it in Google AI Studio). Or run `supabase secrets set GEMINI_API_KEY=... --project-ref rndukbzegenpextindwd`. Until it is set, every prompt gets a quick estimate.
2. **Anonymous sign-ins** (already on) and **Authentication → Rate Limits → anonymous sign-ins**: the default is **30 per hour per IP**. A room full of students on campus Wi-Fi can share one IP, so raise it to about 300 before a meeting.
3. Optional: `ALLOWED_ORIGINS` function secret for a custom domain (comma-separated). `*.vercel.app` and localhost are allowed by default.

**Vercel:** import the GitHub repo, framework Vite, build `npm run build`, output `dist`, and set the env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. `vercel.json` carries the CSP and SPA rewrites. Never put any other secret in a `VITE_*` variable; `vite.config.ts` refuses to build if you do.

## Running it at a meeting

- **Host a room:** Home → Hosting? → Host a game (or the Host link in the header). Pick the time per scenario and project the stage. Players scan the QR code or type the code. Use **Start**, then **Next scenario**, then **Finish** in the bottom bar. The stage shows the timer, "Submitted X of Y", the live board, and a top-3 podium. Opening a new room ends your previous one, and rooms expire after 12 hours. If you refresh, Host a game offers "Resume game".
- **Grader trouble mid-meeting:** in the SQL editor, set `grader_mode` to `"estimate"` so everyone gets instant keyword scores (shown with `~`), then set it back to `"gemini"`.
- **New season:** in the SQL editor, run `update game_private.seasons set status = 'archived', ended_at = now() where status = 'active'; insert into game_private.seasons (name) values ('Spring 2027');`. Archived seasons stay viewable from the leaderboard's season picker.
- **Remove an inappropriate nickname:** `delete from game_private.players where nickname = '...';` (their scores go with it).

## Before each meeting

- [ ] Open the site and confirm the Supabase project is not paused (free projects pause after 7 idle days; restore it from the dashboard).
- [ ] `grader_mode` is `"gemini"` (`select * from game_private.app_settings;`).
- [ ] The anonymous sign-in rate limit is raised (see Deploy).
- [ ] Open the host stage on the projector laptop and test-join from a phone.

## Security notes

- No service-role key in the browser. The bundle is checked for `AIza`, `service_role`, `sb_secret_`, and grader notes on every build.
- Prompt injection: student text is fenced in `<<<student_prompt>>> ... <<<end>>>` (forged delimiters are stripped), the system instruction says to ignore instructions inside it, output uses a strict JSON schema, and every number is re-clamped server-side.
- Rate limits: register 10/h, create room 10/h, join 30/h, rename 3/day, 6 solo prompts per player per day.
- If bot sign-ups appear, enable Supabase CAPTCHA/Turnstile for anonymous sign-ins.
- Retention: rooms are deleted a day after they expire (nightly pg_cron). Players, submissions, and anonymous auth users stay until removed.
