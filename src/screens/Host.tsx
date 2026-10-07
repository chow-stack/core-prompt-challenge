// Host projector stage (Kahoot-style): giant join code + QR, big scenario and timer, live board, podium,
// and a fixed bottom bar with the one next action. Hosts spectate; they do not play.
import { useEffect, useState } from "react";
import { SC_COUNT } from "../../shared/scoring.ts";
import { api, store } from "../api.ts";
import { QrCode } from "../components/QrCode.tsx";
import { LeaderboardTable } from "../components/LeaderboardTable.tsx";
import { formatClock, navigate, secondsLeft, useAction, useNow } from "../hooks.ts";
import { useApp } from "../state.tsx";
import type { AdminStats, BoardRow } from "../types.ts";
import { useGame } from "./Live.tsx";

const TIMERS = [
  [120, "2 minutes"],
  [180, "3 minutes"],
  [300, "5 minutes"],
  [480, "8 minutes"],
] as const;

export function HostStart() {
  const { me } = useApp();
  const [timer, setTimer] = useState(300);
  const [rooms, setRooms] = useState<AdminStats["rooms"]>([]);
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (me?.is_admin) api.adminStats().then((s) => setRooms(s.rooms.filter((r) => r.host === me.nickname)), () => {});
  }, [me]);

  if (me === undefined) return <p className="muted">Loading...</p>;
  if (!me?.is_admin)
    return (
      <>
        <h1>Host a game</h1>
        <div className="note">Only club leaders can host live games. If you are one, unlock admin access first.</div>
        <button className="btn alt" type="button" onClick={() => navigate("/admin")}>
          Admin access
        </button>
      </>
    );
  return (
    <>
      <h1>Host a game</h1>
      <p className="lead">Run a live round for the whole club. You will get a join code, a QR code, and a live leaderboard.</p>
      <section className="panel">
        <h2>New game</h2>
        <fieldset className="choices">
          <legend>Time per scenario</legend>
          {TIMERS.map(([s, label]) => (
            <label key={s} className="choice">
              <input type="radio" name="timer" checked={timer === s} onChange={() => setTimer(s)} /> {label}
            </label>
          ))}
        </fieldset>
        {error && (
          <div className="note" role="alert">
            {error}
          </div>
        )}
        <button
          className="btn block"
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const s = await api.gameCreate(timer);
              store.set("host", s.game.id);
              navigate("/host/" + s.game.id);
            })
          }
        >
          {busy ? "Opening a game..." : "Open a game room"}
        </button>
      </section>
      {rooms.length > 0 && (
        <section className="panel">
          <h2>Your open games</h2>
          {rooms.map((r) => (
            <button key={r.id} className="btn alt block" type="button" onClick={() => navigate("/host/" + r.id)}>
              Resume game {r.code} ({r.players} player{r.players === 1 ? "" : "s"})
            </button>
          ))}
        </section>
      )}
    </>
  );
}

export function HostStage({ gameId }: { gameId: string }) {
  const { state, setState, board, error, offset } = useGame(gameId);
  const now = useNow(250);
  const [copied, setCopied] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const act = useAction();
  const link = typeof location !== "undefined" ? `${location.origin}/?code=${state?.game.code ?? ""}` : "";

  useEffect(() => {
    document.body.classList.add("stage-mode");
    return () => document.body.classList.remove("stage-mode");
  }, []);
  useEffect(() => {
    if (state && state.role !== "host") navigate("/game/" + gameId, true);
  }, [state, gameId]);

  if (!state)
    return (
      <div className="stage-msg">
        {error ? (
          <>
            <p>{error}</p>
            <button className="btn" type="button" onClick={() => navigate("/host")}>
              Back
            </button>
          </>
        ) : (
          <p>Opening the stage...</p>
        )}
      </div>
    );

  const g = state.game;
  const left = secondsLeft(g.scenario_ends_at, offset, now);
  const advance = () => act.run(async () => setState(await api.gameAdvance(g.id)));
  const end = () =>
    act.run(async () => {
      setState(await api.gameEnd(g.id));
      setConfirmEnd(false);
    });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("Copied");
    } catch {
      setCopied("Select and copy");
    }
    setTimeout(() => setCopied(""), 1800);
  };
  const primary =
    g.phase === "lobby" ? "Start" : g.phase === "playing" ? (g.scenario_idx === SC_COUNT - 1 ? "Finish" : "Next scenario") : "Host a new game";

  return (
    <div className="stage">
      <header className="stage-top">
        <span className="stage-brand">The CORE Prompt Challenge</span>
        <span className="stage-chip">
          Code <b>{g.code}</b>
        </span>
        <span className="stage-chip">
          <b>{state.player_count}</b> {state.player_count === 1 ? "player" : "players"}
        </span>
        <span className="stage-pips" aria-label={g.phase === "playing" ? `Scenario ${g.scenario_idx + 1} of ${SC_COUNT}` : undefined}>
          {Array.from({ length: SC_COUNT }, (_, i) => (
            <i key={i} className={i < g.scenario_idx || g.phase === "finished" ? "done" : i === g.scenario_idx ? "on" : ""} />
          ))}
        </span>
      </header>

      {error && <div className="stage-error" role="alert">{error}</div>}

      {g.phase === "lobby" && (
        <div className="stage-lobby">
          <section className="stage-card join">
            <div className="lbl center">Join code</div>
            <div className="bigcode">{g.code}</div>
            <p className="center muted">Choose Join a live game and type the code, or scan this QR code.</p>
            <QrCode text={link} />
            <label htmlFor="link">Share link</label>
            <div className="row">
              <input id="link" value={link} readOnly onFocus={(e) => e.target.select()} />
              <button className="btn alt" type="button" onClick={copy}>
                {copied || "Copy"}
              </button>
            </div>
          </section>
          <section className="stage-card">
            <h2>Ready when you are</h2>
            <p>Let everyone join, then start. Each scenario appears on every player&rsquo;s phone at the same time.</p>
            <p className="count">
              <b>{state.player_count}</b> {state.player_count === 1 ? "player joined" : "players joined"}
            </p>
            <ul className="chips" aria-live="polite">
              {state.players.map((p) => (
                <li key={p.id}>{p.nickname}</li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {g.phase === "playing" && state.scenario && (
        <div className="stage-play">
          <section className="stage-card scenario">
            <div className="stage-scenario-head">
              <div className="lbl">
                Scenario {g.scenario_idx + 1} of {SC_COUNT}
              </div>
              {left != null && (
                <div className={"stage-timer" + (left <= 30 ? " low" : "")} role="timer">
                  {left > 0 ? formatClock(left) : "Time"}
                </div>
              )}
            </div>
            <h2 className="stage-title">{state.scenario.title}</h2>
            <p className="stage-sit">{state.scenario.situation}</p>
            <p className="stage-goal">
              <b>Goal:</b> {state.scenario.goal}
            </p>
            <p className="stage-count">
              Submitted: <b>{state.submitted}</b> of <b>{state.player_count}</b>
            </p>
          </section>
          <section className="stage-card">
            <h2>Leaderboard</h2>
            <LeaderboardTable rows={board?.ranked ?? []} current={g.scenario_idx} />
          </section>
        </div>
      )}

      {g.phase === "finished" && (
        <div className="stage-final">
          <h1 className="stage-h1">Final standings</h1>
          <Podium rows={board?.ranked ?? []} />
          <section className="stage-card">
            <LeaderboardTable rows={board?.ranked ?? []} />
            <p className="muted">Live scores also count toward the season leaderboard.</p>
          </section>
        </div>
      )}

      <footer className="stage-bar">
        {confirmEnd ? (
          <>
            <span>End this game for everyone?</span>
            <button className="btn danger" type="button" onClick={end} disabled={act.busy}>
              End game
            </button>
            <button className="btn alt light" type="button" onClick={() => setConfirmEnd(false)}>
              Keep playing
            </button>
          </>
        ) : (
          <>
            {g.phase !== "finished" && (
              <button className="btn alt light" type="button" onClick={() => setConfirmEnd(true)}>
                End game
              </button>
            )}
            {g.phase === "finished" && (
              <button className="btn alt light" type="button" onClick={() => navigate("/")}>
                Home
              </button>
            )}
            <button
              className="btn big"
              type="button"
              disabled={act.busy}
              onClick={g.phase === "finished" ? () => navigate("/host") : advance}
            >
              {primary}
            </button>
          </>
        )}
        {act.error && <span className="stage-bar-error" role="alert">{act.error}</span>}
      </footer>
    </div>
  );
}

function Podium({ rows }: { rows: BoardRow[] }) {
  const top = rows.slice(0, 3);
  if (!top.length) return <p className="stage-msg">No scores yet.</p>;
  // Display order 2, 1, 3 like a real podium.
  const order = [top[1], top[0], top[2]].filter(Boolean) as BoardRow[];
  return (
    <ol className="podium" aria-label="Top three">
      {order.map((p) => {
        const place = top.indexOf(p) + 1;
        return (
          <li key={p.nickname} className={"place p" + place}>
            <span className="who">{p.nickname}</span>
            <span className="pts">
              {p.has_estimate ? "~" : ""}
              {p.total}
            </span>
            <span className="block">{place}</span>
          </li>
        );
      })}
    </ol>
  );
}
