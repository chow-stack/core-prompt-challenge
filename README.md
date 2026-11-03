# The CORE Prompt Challenge

**A competitive prompt-engineering game: write prompts for real-world scenarios, get graded by an LLM on the CORE framework, and climb a season leaderboard.**

Players write prompts for six scenarios (three for school, three just for fun) and get scored on **CORE**: **C**ontext, **O**utput, **R**ules, and **E**xamples. They can play solo any time, or join a live room at a meeting, with a join code, a QR code, a timer, and a projector view.

Built for the Gen AI Club at Indiana University. Grading uses Google Gemini through a queued, quota-aware Supabase Edge Function, so the whole thing runs on free tiers.

![React](https://img.shields.io/badge/React-19-61dafb) ![Vite](https://img.shields.io/badge/Vite-8-646cff) ![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Edge%20Functions-3ecf8e) ![Gemini](https://img.shields.io/badge/Grader-Gemini-4285f4) ![License: MIT](https://img.shields.io/badge/license-MIT-blue)

---

## Contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Commands](#commands)
- [Deployment](#deployment)
- [Running it at a meeting](#running-it-at-a-meeting)
- [Security](#security)
- [Project structure](#project-structure)
- [License](#license)

## How it works

| Mode | Who | Rules |
|---|---|---|
| **Solo (season)** | Anyone with the link | **One graded try per scenario.** After submitting, the player moves to the next scenario while Gemini grades in the background, and scores arrive as toasts. The season score is the sum of all six scores (max 600). Only players who have completed all six are ranked, and ties go to whoever finished first. |
| **Live room** | Anyone can host; anyone can join | One try per scenario per room, on a timer the host sets. Grading continues in the background if the host moves on. Live scores also count toward the season board (best score per scenario). Hosts spectate. |

- **Identity.** A nickname plus Supabase Anonymous Auth, tied to the browser. No accounts or passwords. Players can rename themselves three times a day.
- **Privacy.** Players see only their own prompts, and boards show scores, never prompt text. Prompts are graded by Gemini's free tier, which Google may use to improve its products, so the compose screen warns against including personal information. The only personal data collected is a nickname.
- **Fallback grading.** When the AI grader is unavailable, a keyword-based estimate is used and shown with a `~` prefix.

## Architecture

```
Browser (React 19 + Vite)  ──RPC──▶  Supabase Postgres (RLS, game_private schema, security-definer functions)
        │                                         ▲
        └─invoke grade-prompt (JWT)──▶ Edge Function ──svc_* (service role)──┘
                                           │
                                           └──▶ Gemini generateContent (key in function secret)
pg_cron (every minute) ──▶ drain-queue Edge Function (Vault token)   # backstop for queued prompts and regrades
```

- **`shared/scoring.ts`** contains the pure scoring logic (`finalize`, `localGrade`, grader prompt builders). It is shared by Node tests, the Edge Functions (copied to `supabase/functions/_shared/` by `scripts/sync-shared.mjs`), and the browser.
- **`shared/scenarios.ts`** holds the six scenarios. It is server-only: the seed migration is generated from it, and the hidden grader notes and keyword patterns never reach the browser. `scripts/check-dist.mjs` enforces this on every build.
- **`supabase/migrations/`** has the schema, seed, and RPCs. Public RPCs are thin `security invoker` wrappers over `game_private.*` `security definer` functions with an empty `search_path`. Private tables have RLS enabled and no client grants. `svc_*` functions are executable only by `service_role`.
- **`supabase/functions/`**: `grade-prompt` grades the caller's own submission (JWT required), and `drain-queue` is a cron backstop authorized by a token stored in Supabase Vault.
- **`src/`** is the React app, with screens for Home, Solo, Board, Live (player), and Host (projector stage). `src/state.tsx` tracks background grading, survives reloads, and raises "score is in" toasts.

### Gemini quota management (free tier: 15 RPM and 500 RPD per model; RPD resets at midnight Pacific)

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

## Getting started

### Prerequisites

- Node.js 22.6 or newer (tests use Node's built-in TypeScript type stripping)
- A Supabase project with **Anonymous Sign-ins** enabled and the `pg_cron`, `pg_net`, and `vault` extensions available
- The [Supabase CLI](https://supabase.com/docs/guides/cli), for migrations and Edge Functions
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

### 1. Install

```bash
git clone https://github.com/chow-stack/core-prompt-challenge.git
cd core-prompt-challenge
npm install
```

### 2. Set up Supabase

```bash
supabase link --project-ref <your-project-ref>
```

Before pushing migrations, open `supabase/migrations/20261007160900_drain_cron.sql` and replace the project URL in the `drain-grading-queue` job with your own `https://<your-project-ref>.supabase.co`. Then:

```bash
supabase db push
supabase functions deploy grade-prompt
supabase functions deploy drain-queue
supabase secrets set GEMINI_API_KEY=<your-gemini-key>
```

Until `GEMINI_API_KEY` is set, every prompt gets a keyword estimate.

To enable the admin controls, set a passphrase (stored bcrypt-hashed) from the SQL editor:

```sql
select game_private.set_admin_passphrase('a long passphrase of at least 12 characters');
```

### 3. Configure the environment

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | `https://<your-project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | The project's **publishable** key (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Tests only | Lets the integration and load tests switch the grader to mock mode. Never prefix it with `VITE_`. |
| `GEMINI_API_KEY` | Calibration only | Used by `tests/calibration.mjs` |

`vite.config.ts` refuses to build if any non-publishable key appears in a `VITE_*` variable.

### 4. Run

```bash
npm run dev
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm test` | Unit tests for the scoring logic (no build needed) |
| `npm run build` | Secret scan → type check → Vite build → bundle leak check |
| `npm run check:secrets` | Scan source and config files for credentials |
| `npm run test:integration` | Live end-to-end checks against Supabase (mock grader; cleans up after itself) |
| `npm run test:load` | `BOTS=40` concurrent bots (mock grader). Add `RPM=3` to force queueing with fewer bots. |
| `npm run test:calibration` | Grades 12 prompts plus an injection test on both Gemini models and writes `tests/calibration-results.md` |
| `tests/scoring.sql` | Transactional ranking, tie-break, room, quota, and rollover fixtures. Paste into the SQL editor; it rolls back. |

**Changing content:**

- After editing `shared/scoring.ts`, run `node scripts/sync-shared.mjs` and redeploy the Edge Functions.
- After editing `shared/scenarios.ts`, run `node scripts/gen-seed.mjs --scenarios-only` and save the output as a **new** migration.

## Deployment

**Supabase**

1. Complete [step 2 of Getting started](#2-set-up-supabase).
2. Under **Authentication → Rate Limits**, raise the anonymous sign-in limit. The default is 30 per hour per IP, and a room full of students on campus Wi-Fi often shares one IP, so about 300 works well.
3. Optional: set an `ALLOWED_ORIGINS` function secret (comma-separated) for a custom domain. `*.vercel.app` and localhost are allowed by default.

**Vercel**

Import the repository, choose the Vite framework preset (build command `npm run build`, output `dist`), and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. `vercel.json` provides the Content Security Policy, security headers, and SPA rewrites.

## Running it at a meeting

- **Host a room:** Home → *Hosting?* → *Host a game*. Pick the time per scenario and project the stage. Players scan the QR code or type the code. Use **Start**, **Next scenario**, and **Finish**. The stage shows the timer, "Submitted X of Y", the live board, and a top-3 podium. Rooms expire after 12 hours, and refreshing offers *Resume game*.
- **Grader trouble mid-meeting:** set `grader_mode` to `"estimate"` for instant keyword scores, then set it back to `"gemini"`.
- **New season:** `update game_private.seasons set status = 'archived', ended_at = now() where status = 'active'; insert into game_private.seasons (name) values ('Spring 2027');`. Archived seasons stay viewable from the leaderboard.
- **Remove an inappropriate nickname:** `delete from game_private.players where nickname = '...';` (their scores go with it).

**Pre-meeting checklist**

- [ ] The Supabase project isn't paused (free projects pause after 7 idle days).
- [ ] `grader_mode` is `"gemini"` (`select * from game_private.app_settings;`).
- [ ] The anonymous sign-in rate limit has been raised.
- [ ] The host stage is open on the projector laptop, and a test join from a phone works.

## Security

- **No privileged keys in the browser.** Only the publishable key ships to clients. Every build scans the bundle for `AIza`, `service_role`, `sb_secret_`, and grader notes, and fails if it finds any.
- **Database-enforced authorization.** Each player is bound to `auth.uid()`. Private tables are default-deny, and every action runs through narrowly scoped `security definer` functions.
- **Prompt-injection hardening.** Student text is fenced in `<<<student_prompt>>> ... <<<end>>>` with forged delimiters stripped. The system instruction says to ignore instructions inside the fence, output follows a strict JSON schema, and every score is re-clamped server-side.
- **Rate limits.** Register 10/hour, create room 10/hour, join 30/hour, rename 3/day, 6 solo prompts per player per day, and 30 distinct solo prompts per IP per hour.
- **Secrets at rest.** The admin passphrase is stored as a bcrypt hash, and the cron token lives in Supabase Vault.
- **Retention.** Rooms are deleted a day after they expire (nightly pg_cron). Players, submissions, and anonymous auth users stay until removed.
- If bot sign-ups appear, enable Supabase CAPTCHA (Turnstile) for anonymous sign-ins.

To report a vulnerability, please open a private [security advisory](https://github.com/chow-stack/core-prompt-challenge/security/advisories/new) rather than a public issue.

## Project structure

```
src/                    React app (screens, components, hooks, background grading state)
shared/                 Scoring logic and scenarios shared by browser, tests, and Edge Functions
supabase/
├── migrations/         Schema, seed, RPCs, cron jobs (apply in order)
└── functions/          grade-prompt and drain-queue Edge Functions (Deno)
scripts/                Secret scan, bundle check, seed generator, shared-code sync
tests/                  Unit, integration, load, calibration, and SQL fixtures
reference/              The original single-file prototype (source of truth for scenarios and scoring)
PLAN.md                 Implementation plan and design decisions
```

## Acknowledgements

The scenarios, scoring math, grader prompt, copy, and palette come from the original prototype in [`reference/artifact-original.html`](reference/artifact-original.html).

## License

Released under the [MIT License](LICENSE).
