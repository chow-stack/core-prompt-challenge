# CORE Prompt Challenge project index

Updated: 2026-10-07

- [Run, rules, architecture, deployment, running it at a meeting](README.md)
- [Implementation plan](PLAN.md)
- [Original prototype (source of truth)](reference/artifact-original.html)
- [Scoring port (shared by tests, functions, browser)](shared/scoring.ts)
- [Scenario bank (server-only)](shared/scenarios.ts)
- [React app entry](src/App.tsx), [API layer](src/api.ts), [app state + background grading tracker](src/state.tsx), [hooks: router, realtime](src/hooks.ts)
- Screens: [Home](src/screens/Home.tsx), [Solo](src/screens/Solo.tsx), [Board](src/screens/Board.tsx), [Live player](src/screens/Live.tsx), [Host stage](src/screens/Host.tsx)
- [Styles (prototype palette + projector stage)](src/style.css)
- [Database migrations](supabase/migrations/)
- [Grader worker](supabase/functions/_shared/worker.ts), [Gemini client](supabase/functions/_shared/gemini.ts)
- Edge Functions: [grade-prompt](supabase/functions/grade-prompt/index.ts), [drain-queue](supabase/functions/drain-queue/index.ts)
- Tests: [unit](tests/scoring.test.ts), [SQL fixtures](tests/scoring.sql), [integration](tests/integration.mjs), [load](tests/load.mjs), [calibration](tests/calibration.mjs)
- Scripts: [secret scan](scripts/check-secrets.mjs), [dist leak check](scripts/check-dist.mjs), [seed generator](scripts/gen-seed.mjs), [shared sync](scripts/sync-shared.mjs)
- [Vercel config (CSP, rewrites)](vercel.json), [Vite env guard](vite.config.ts)
- [Change log](log.md)
