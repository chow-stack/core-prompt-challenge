// Solo (season) play: six scenarios, up to 3 graded tries each, best score counts. Port of renderSolo.
import { useCallback, useEffect, useState } from "react";
import { SC_COUNT } from "../../shared/scoring.ts";
import { api, errorText } from "../api.ts";
import { Bar, ScenarioBlock } from "../components/CoreCards.tsx";
import { Composer, GradingView, ResultView, SummaryView, clearDraft } from "../components/Grading.tsx";
import { RegisterForm } from "../components/Identity.tsx";
import { navigate, useAction, useGrading } from "../hooks.ts";
import { useApp } from "../state.tsx";
import { isGraded, type Graded, type Progress } from "../types.ts";

export function Solo({ step, summary }: { step: number | null; summary: boolean }) {
  const { me, scenarios } = useApp();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(() => {
    api.progress().then(setProgress, (e) => setLoadError(errorText(e)));
  }, []);
  useEffect(() => {
    if (me) load();
  }, [me, load]);

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
  const firstOpen = progress.scenarios.findIndex((s) => !s.best);
  const i = step != null && step >= 0 && step < SC_COUNT ? step : Math.max(0, firstOpen);
  return <SoloScenario key={i} i={i} progress={progress} reload={load} />;
}

function Pips({ progress, i }: { progress: Progress; i: number }) {
  return (
    <nav className="pips" aria-label="Scenarios">
      {progress.scenarios.map((s, k) => (
        <button
          key={s.scenario_id}
          type="button"
          className={"pip" + (k === i ? " on" : "") + (s.best ? " done" : "")}
          aria-current={k === i ? "step" : undefined}
          aria-label={`Scenario ${k + 1}${s.best ? `, best ${s.best.percent}%` : ""}`}
          onClick={() => navigate("/play?s=" + (k + 1))}
        >
          {s.best ? (s.best.is_estimate ? "~" : "") + s.best.percent : k + 1}
        </button>
      ))}
      <button type="button" className="pip sum" onClick={() => navigate("/play/summary")}>
        Results
      </button>
    </nav>
  );
}

function SoloScenario({ i, progress, reload }: { i: number; progress: Progress; reload: () => void }) {
  const { scenarios } = useApp();
  const sc = scenarios[i];
  const sp = progress.scenarios[i];
  const latestPending = sp.latest && sp.latest.status !== "graded" ? sp.latest.id : null;
  const [pendingId, setPendingId] = useState<string | null>(latestPending);
  const [shown, setShown] = useState<Graded | null>(null);
  const [compose, setCompose] = useState(false);
  const { busy, error, run } = useAction();
  const draftKey = "solo:" + sc.id;

  const { sub, error: pollError } = useGrading(pendingId, (s) => {
    if (isGraded(s)) setShown(s);
    setPendingId(null);
    setCompose(false);
    reload();
  });

  const submit = (text: string) =>
    run(async () => {
      const r = await api.submit(sc.id, text);
      clearDraft(draftKey);
      setShown(null);
      setPendingId(r.submission_id);
    });

  const scored = progress.scenarios.filter((s) => s.best).length;
  const left = sp.attempts_left;
  const closed = !progress.play_open ? "Play is closed right now. Check back when the club opens it again." : !progress.season_active ? "This season has ended." : progress.daily_left <= 0 ? "You have reached today's grading limit. Come back tomorrow." : "";
  const result = shown ?? (isGraded(sp.best) ? sp.best : null);
  const last = i === SC_COUNT - 1;

  let body;
  if (pendingId) body = <GradingView sub={sub} error={pollError} />;
  else if (result && !compose)
    body = (
      <>
        <ResultView res={result} label={shown ? "Your score for this scenario" : "Your best score for this scenario"} />
        {shown && sp.best && sp.best.id !== shown.id && (
          <p className="muted">Your best on this scenario is still {sp.best.percent}%. Only your best counts.</p>
        )}
        <div className="actions">
          <button className="btn block" type="button" onClick={() => navigate(last ? "/play/summary" : "/play?s=" + (i + 2))}>
            {last ? "See my results" : "Next scenario"}
          </button>
          {left > 0 ? (
            <button className="btn alt block" type="button" disabled={!!closed} onClick={() => (setShown(null), setCompose(true))}>
              Try again ({left} left)
            </button>
          ) : (
            <p className="muted center">You have used all 3 tries on this scenario. Your best score counts.</p>
          )}
        </div>
      </>
    );
  else
    body = (
      <Composer
        draftKey={draftKey}
        note={left === 3 ? "You get 3 tries per scenario. Your best score counts." : `${left} of 3 tries left. Your best score counts.`}
        busy={busy}
        error={error}
        disabled={left <= 0 ? "You have used all 3 tries on this scenario." : closed}
        onSubmit={submit}
      />
    );

  return (
    <>
      <Bar pct={(scored / SC_COUNT) * 100} />
      <Pips progress={progress} i={i} />
      <ScenarioBlock s={sc} />
      <div className="sp" />
      {body}
    </>
  );
}

function SoloSummary({ progress }: { progress: Progress }) {
  const { me, scenarios } = useApp();
  const results = progress.scenarios.map((s) => (isGraded(s.best) ? s.best : null));
  const done = results.filter(Boolean).length;
  return (
    <>
      <Pips progress={progress} i={-1} />
      <h1>Your results</h1>
      <p className="lead">
        {done === SC_COUNT
          ? `Nice work, ${me?.nickname}. Here is how your prompts did across all six scenarios.`
          : `${done} of 6 scenarios done, ${me?.nickname}. Finish all six to get ranked on the leaderboard.`}
      </p>
      <SummaryView scenarios={scenarios} results={results} />
      <p className="season-total">
        Season score: <b>{progress.total}</b> / 600
      </p>
      {done < SC_COUNT && (
        <button className="btn block" type="button" onClick={() => navigate("/play?s=" + (results.findIndex((r) => !r) + 1))}>
          Keep playing
        </button>
      )}
      <button className={"btn block" + (done < SC_COUNT ? " alt" : "")} type="button" onClick={() => navigate("/board")}>
        View the leaderboard
      </button>
      <button className="btn alt block" type="button" onClick={() => navigate("/")}>
        Back to home
      </button>
    </>
  );
}
