// Solo (season) play: six scenarios, one graded try each. After submitting, the player moves straight on to the
// next scenario while Gemini grades in the background; scores pop up as toasts and fill in the pips.
import { useCallback, useEffect, useState } from "react";
import { SC_COUNT } from "../../shared/scoring.ts";
import { api, errorText } from "../api.ts";
import { Bar, ScenarioBlock } from "../components/CoreCards.tsx";
import { Composer, GradingView, ResultView, SummaryView, clearDraft } from "../components/Grading.tsx";
import { RegisterForm } from "../components/Identity.tsx";
import { navigate, useAction } from "../hooks.ts";
import { useApp, useSubmission } from "../state.tsx";
import { isGraded, type Progress, type Submission } from "../types.ts";

/** Where to go after scenario i: the next scenario not yet submitted, else the results page. */
function nextOpen(progress: Progress, i: number, justSubmitted = -1): string {
  for (let d = 1; d < SC_COUNT; d++) {
    const k = (i + d) % SC_COUNT;
    if (k !== justSubmitted && !progress.scenarios[k].latest) return "/play?s=" + (k + 1);
  }
  return "/play/summary";
}

export function Solo({ step, summary }: { step: number | null; summary: boolean }) {
  const { me, scenarios, gradedTick } = useApp();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(() => {
    api.progress().then(setProgress, (e) => setLoadError(errorText(e)));
  }, []);
  useEffect(() => {
    if (me) load();
  }, [me, load, gradedTick]);
  // Pin "/play" to a concrete step (the first scenario not yet submitted).
  const firstOpen = progress ? progress.scenarios.findIndex((s) => !s.latest) : -1;
  useEffect(() => {
    if (progress && !summary && step == null) navigate(firstOpen < 0 ? "/play/summary" : "/play?s=" + (firstOpen + 1), true);
  }, [progress, summary, step, firstOpen]);

  if (me === undefined) return <p className="muted">Loading...</p>;
  if (me === null)
    return (
      <>
        <h1>Pick a nickname</h1>
        <p className="lead">You need a nickname to play and show up on the leaderboard.</p>
        <section className="panel">
          <RegisterForm id="n1" cta="Start playing" onReady={() => navigate("/play")} />
        </section>
      </>
    );
  if (loadError) return <div className="note" role="alert">{loadError}</div>;
  if (!progress || scenarios.length < SC_COUNT) return <p className="muted">Loading your progress...</p>;
  if (summary) return <SoloSummary progress={progress} />;
  if (step == null) return null;
  const i = step >= 0 && step < SC_COUNT ? step : 0;
  // Mark a scenario as submitted right away so pips and the banner show "grading" before the refetch lands.
  const markSubmitted = (k: number, id: string, prompt: string) =>
    setProgress((p) => {
      if (!p) return p;
      const stub = { id, scenario_id: p.scenarios[k].scenario_id, status: "queued", prompt, percent: null, queue_position: 0 } as Submission;
      const scenarios = p.scenarios.map((s, j) => (j === k ? { ...s, latest: stub, attempts_left: 0 } : s));
      return { ...p, scenarios };
    });
  return <SoloScenario key={i} i={i} progress={progress} reload={load} markSubmitted={markSubmitted} />;
}

function Pips({ progress, i }: { progress: Progress; i: number }) {
  const { subs } = useApp();
  return (
    <nav className="pips" aria-label="Scenarios">
      {progress.scenarios.map((s, k) => {
        const latest = s.latest ? (subs[s.latest.id] ?? s.latest) : null;
        const graded = isGraded(latest) ? latest : null;
        const pending = latest && !graded;
        return (
          <button
            key={s.scenario_id}
            type="button"
            className={"pip" + (k === i ? " on" : "") + (graded ? " done" : "") + (pending ? " pending" : "")}
            aria-current={k === i ? "step" : undefined}
            aria-label={`Scenario ${k + 1}${graded ? `, ${graded.percent}%` : pending ? ", grading" : ""}`}
            onClick={() => navigate("/play?s=" + (k + 1))}
          >
            {graded ? (graded.is_estimate ? "~" : "") + graded.percent : pending ? <span className="dots" aria-hidden="true" /> : k + 1}
          </button>
        );
      })}
      <button type="button" className={"pip sum" + (i === -1 ? " on" : "")} onClick={() => navigate("/play/summary")}>
        Results
      </button>
    </nav>
  );
}

/** "Grading in the background" banner for solo prompts still in flight. */
function BackgroundBanner({ progress }: { progress: Progress }) {
  const { subs } = useApp();
  const n = progress.scenarios.filter((s) => s.latest && (subs[s.latest.id] ?? s.latest).status !== "graded").length;
  if (!n) return null;
  return (
    <div className="bg-banner" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>
        Grading {n} prompt{n === 1 ? "" : "s"} in the background. Keep going; scores pop up when they are ready.
      </span>
    </div>
  );
}

function SoloScenario({
  i,
  progress,
  reload,
  markSubmitted,
}: {
  i: number;
  progress: Progress;
  reload: () => void;
  markSubmitted: (k: number, id: string, prompt: string) => void;
}) {
  const { scenarios, track } = useApp();
  const sc = scenarios[i];
  const sp = progress.scenarios[i];
  const live = useSubmission(sp.latest?.id ?? null);
  const latest: Submission | null = live ?? sp.latest;
  const { busy, error, run } = useAction();
  const draftKey = "solo:" + sc.id;
  const scored = progress.scenarios.filter((s) => s.latest).length;
  const closed = !progress.play_open
    ? "Play is closed right now. Check back when the club opens it again."
    : !progress.season_active
      ? "This season has ended."
      : progress.daily_left <= 0
        ? "You have reached today's grading limit. Come back tomorrow."
        : "";
  const next = nextOpen(progress, i);
  const nextLabel = next === "/play/summary" ? "See my results" : "Next scenario";

  const submit = (text: string) =>
    run(async () => {
      const r = await api.submit(sc.id, text);
      clearDraft(draftKey);
      markSubmitted(i, r.submission_id, text);
      track(r.submission_id);
      reload();
      navigate(nextOpen(progress, i, i));
    });

  let body;
  if (isGraded(latest))
    body = (
      <>
        <ResultView res={latest} />
        <button className="btn block" type="button" onClick={() => navigate(next)}>
          {nextLabel}
        </button>
      </>
    );
  else if (latest)
    body = (
      <>
        <GradingView sub={latest} background />
        <button className="btn block" type="button" onClick={() => navigate(next)}>
          {nextLabel}
        </button>
      </>
    );
  else
    body = (
      <Composer
        draftKey={draftKey}
        note="One try per scenario, so make it count. You can move on while it is graded."
        busy={busy}
        error={error}
        disabled={closed}
        onSubmit={submit}
      />
    );

  return (
    <>
      <Bar pct={(scored / SC_COUNT) * 100} />
      <Pips progress={progress} i={i} />
      <BackgroundBanner progress={progress} />
      <ScenarioBlock s={sc} />
      <div className="sp" />
      {body}
    </>
  );
}

function SoloSummary({ progress }: { progress: Progress }) {
  const { me, scenarios, subs } = useApp();
  const latest = progress.scenarios.map((s) => (s.latest ? (subs[s.latest.id] ?? s.latest) : null));
  const results = latest.map((s) => (isGraded(s) ? s : null));
  const pending = latest.map((s) => !!s && !isGraded(s));
  const submitted = latest.filter(Boolean).length;
  const graded = results.filter(Boolean).length;
  const waiting = pending.filter(Boolean).length;
  return (
    <>
      <Pips progress={progress} i={-1} />
      <BackgroundBanner progress={progress} />
      <h1>Your results</h1>
      <p className="lead">
        {graded === SC_COUNT
          ? `Nice work, ${me?.nickname}. Here is how your prompts did across all six scenarios.`
          : submitted === SC_COUNT
            ? `All six submitted, ${me?.nickname}. ${waiting} still grading; this page updates on its own.`
            : `${submitted} of 6 scenarios done, ${me?.nickname}. Finish all six to get ranked on the leaderboard.`}
      </p>
      <SummaryView scenarios={scenarios} results={results} pending={pending} />
      <p className="season-total">
        Season score: <b>{progress.total}</b> / 600
      </p>
      {submitted < SC_COUNT && (
        <button className="btn block" type="button" onClick={() => navigate("/play?s=" + (latest.findIndex((r) => !r) + 1))}>
          Keep playing
        </button>
      )}
      <button className={"btn block" + (submitted < SC_COUNT ? " alt" : "")} type="button" onClick={() => navigate("/board")}>
        View the leaderboard
      </button>
      <button className="btn alt block" type="button" onClick={() => navigate("/")}>
        Back to home
      </button>
    </>
  );
}
