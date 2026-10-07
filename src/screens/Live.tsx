// Live room, player side (phone-first). Port of renderPlayer, backed by game_state + Realtime.
import { useCallback, useEffect, useRef, useState } from "react";
import { SC_COUNT } from "../../shared/scoring.ts";
import { api, errorText, store } from "../api.ts";
import { ScenarioBlock } from "../components/CoreCards.tsx";
import { Composer, GradingView, ResultView, SummaryView, clearDraft } from "../components/Grading.tsx";
import { LeaderboardTable } from "../components/LeaderboardTable.tsx";
import { formatClock, navigate, secondsLeft, useAction, useLiveRefresh, useNow } from "../hooks.ts";
import { useApp, useSubmission } from "../state.tsx";
import { isGraded, type Board, type GameState, type Graded } from "../types.ts";

/** Room snapshot with stale-revision protection, server clock offset, Realtime + 5 s polling. */
export function useGame(gameId: string) {
  const [state, setState] = useState<GameState | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const rev = useRef(-1);
  const boardRev = useRef(-1);
  const refresh = useCallback(() => {
    const sent = Date.now();
    api.gameState(gameId).then(
      (s) => {
        setError("");
        if (s.game.revision < rev.current) return;
        rev.current = s.game.revision;
        // Midpoint of the request approximates when the server read its clock.
        setOffset(Date.parse(s.server_time) - (sent + Date.now()) / 2);
        setState(s);
        if (boardRev.current !== s.game.revision) {
          boardRev.current = s.game.revision;
          api.leaderboard(null, gameId).then(setBoard, () => {});
        }
      },
      (e) => setError(errorText(e)),
    );
  }, [gameId]);
  useEffect(refresh, [refresh]);
  useLiveRefresh("games", "id=eq." + gameId, refresh, 5000);
  return { state, setState, board, error, offset, refresh };
}

export function Live({ gameId }: { gameId: string }) {
  const { me } = useApp();
  const { state, board, error, offset, refresh } = useGame(gameId);
  const now = useNow(500);
  const isHost = state?.role === "host";
  useEffect(() => {
    if (me === null) navigate("/?code=" + (state?.game.code ?? ""), true);
    else if (isHost) navigate("/host/" + gameId, true);
  }, [me, isHost, gameId, state?.game.code]);

  if (me === null || isHost) return null;
  if (!state)
    return error ? (
      <>
        <div className="note" role="alert">
          {error}
        </div>
        <button className="btn alt" type="button" onClick={() => (store.del("room"), navigate("/"))}>
          Back to home
        </button>
      </>
    ) : (
      <>
        <h2>Joining the game</h2>
        <div className="wait">
          <i />
        </div>
      </>
    );
  const g = state.game;
  const leave = () => {
    store.del("room");
    navigate("/");
  };
  const head = (
    <div className="lbl">
      Game {g.code}, playing as {me?.nickname}
    </div>
  );

  let body;
  if (g.phase === "lobby") {
    body = (
      <>
        <h2>You are in</h2>
        <p>
          Waiting for the host to start. <b>{state.player_count}</b> player{state.player_count === 1 ? " has" : "s have"} joined so far.
        </p>
        <div className="wait">
          <i />
        </div>
      </>
    );
  } else if (g.phase === "finished") {
    body = <Final state={state} board={board} />;
  } else {
    const left = secondsLeft(g.scenario_ends_at, offset, now);
    const mine = state.my_submissions.find((m) => m.scenario_id === state.scenario?.id);
    body = (
      <>
        {left != null && (
          <div className={"timer" + (left <= 30 ? " low" : "")} role="timer" aria-live={left <= 10 ? "assertive" : "off"}>
            {left > 0 ? formatClock(left) + " left" : "Time is up"}
          </div>
        )}
        {state.scenario && <ScenarioBlock s={state.scenario} />}
        <div className="sp" />
        {state.scenario && (
          <LiveTurn
            key={state.scenario.id}
            gameId={g.id}
            scenarioId={state.scenario.id}
            submissionId={mine?.submission_id ?? null}
            timeUp={left === 0 && Date.now() + offset > Date.parse(g.scenario_ends_at ?? "") + 10_000}
            onSubmitted={refresh}
          />
        )}
      </>
    );
  }

  return (
    <>
      {head}
      {body}
      {g.phase === "playing" && (
        <section className="panel gap">
          <h2>Standings</h2>
          <LeaderboardTable rows={board?.ranked ?? []} current={g.scenario_idx} />
        </section>
      )}
      {g.phase !== "finished" && (
        <div>
          <button className="btn alt" type="button" onClick={leave}>
            Leave game
          </button>
        </div>
      )}
    </>
  );
}

function LiveTurn({
  gameId,
  scenarioId,
  submissionId,
  timeUp,
  onSubmitted,
}: {
  gameId: string;
  scenarioId: number;
  submissionId: string | null;
  timeUp: boolean;
  onSubmitted: () => void;
}) {
  const { track } = useApp();
  const [ownId, setOwnId] = useState<string | null>(null);
  const id = ownId ?? submissionId;
  const sub = useSubmission(id);
  const { busy, error, run } = useAction();
  const draftKey = `live:${gameId}:${scenarioId}`;

  if (isGraded(sub))
    return (
      <>
        <ResultView res={sub} />
        <div className="note">Submitted. Waiting for the host to move to the next scenario.</div>
      </>
    );
  if (id)
    return (
      <>
        <div className="note ok">
          <b>Submitted!</b> Your prompt is being graded. The next scenario appears when the host moves on, even if grading is
          still running.
        </div>
        <GradingView sub={sub} />
      </>
    );
  return (
    <Composer
      draftKey={draftKey}
      note="One try per scenario."
      busy={busy}
      error={error}
      disabled={timeUp ? "Time is up for this scenario. Wait for the next one." : ""}
      onSubmit={(text) =>
        run(async () => {
          const r = await api.submit(scenarioId, text, gameId);
          clearDraft(draftKey);
          track(r.submission_id);
          setOwnId(r.submission_id);
          onSubmitted();
        })
      }
    />
  );
}

function Final({ state, board }: { state: GameState; board: Board | null }) {
  const { scenarios } = useApp();
  const [results, setResults] = useState<(Graded | null)[] | null>(null);
  const [pending, setPending] = useState<boolean[]>([]);
  useEffect(() => {
    Promise.all(
      scenarios.slice(0, SC_COUNT).map((s) => {
        const m = state.my_submissions.find((x) => x.scenario_id === s.id);
        return m ? api.gradeStatus(m.submission_id).catch(() => null) : Promise.resolve(null);
      }),
    ).then((rs) => {
      setResults(rs.map((r) => (isGraded(r) ? r : null)));
      setPending(rs.map((r) => !!r && !isGraded(r)));
    });
  }, [state.my_submissions, scenarios]);
  return (
    <>
      <h1>Final standings</h1>
      <LeaderboardTable rows={board?.ranked ?? []} />
      <h2 className="gap">Your results</h2>
      {results ? <SummaryView scenarios={scenarios} results={results} pending={pending} /> : <p className="muted">Loading your results...</p>}
      <p className="muted">Your live scores also count toward the season leaderboard. You can keep improving them in solo play.</p>
      <button className="btn block" type="button" onClick={() => (store.del("room"), navigate("/board"))}>
        View the season leaderboard
      </button>
      <button className="btn alt block" type="button" onClick={() => (store.del("room"), navigate("/"))}>
        Back to home
      </button>
    </>
  );
}
