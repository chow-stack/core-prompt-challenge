import { useEffect, useRef, useState } from "react";
import { cleanName } from "../../shared/scoring.ts";
import { api, store } from "../api.ts";
import { CoreCards } from "../components/CoreCards.tsx";
import { RegisterForm } from "../components/Identity.tsx";
import { navigate, useAction } from "../hooks.ts";
import { useApp } from "../state.tsx";

export function Home({ prefillCode }: { prefillCode: string }) {
  const { me, bootError, reload } = useApp();
  const joinRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (prefillCode.length === 4) setTimeout(() => joinRef.current?.scrollIntoView({ block: "start" }), 60);
  }, [prefillCode]);

  return (
    <>
      <h1>The CORE Prompt Challenge</h1>
      <p className="lead">
        Six real-life scenarios, from exam prep to negotiating with a campus squirrel. Write a prompt for each, and get graded on
        Context, Output, Rules, and Examples.
      </p>
      <CoreCards />
      {bootError && (
        <div className="note" role="alert">
          {bootError}{" "}
          <button className="linkbtn" type="button" onClick={reload}>
            Try again
          </button>
        </div>
      )}

      <section className="panel">
        <h2>Play now</h2>
        <p>Go through all six scenarios on your own. One try per scenario, so make each prompt count.</p>
        {me === undefined ? (
          <p className="muted">Loading...</p>
        ) : me ? (
          <>
            <p className="muted tight">
              Playing as <b>{me.nickname}</b>.
            </p>
            <button className="btn block" type="button" onClick={() => navigate("/play")}>
              Start playing
            </button>
          </>
        ) : (
          <RegisterForm id="n1" cta="Start playing" onReady={() => navigate("/play")} />
        )}
      </section>

      <section className="panel" id="joinp" ref={joinRef}>
        <h2>Join a live game</h2>
        <p>Enter the 4-letter code on the host screen, or scan the QR code.</p>
        <JoinForm prefill={prefillCode} />
      </section>

      <section className="panel">
        <h2>Hosting?</h2>
        <p>Run a live round for the whole club. You will get a join code, a QR code, and a live leaderboard for the projector.</p>
        <button className="btn alt block" type="button" onClick={() => navigate("/host")}>
          Host a game
        </button>
      </section>

      <section className="panel">
        <h2>Leaderboard</h2>
        <p>See who has the best prompts this season. Finish all six scenarios to get ranked.</p>
        <button className="btn alt block" type="button" onClick={() => navigate("/board")}>
          View the leaderboard
        </button>
      </section>

      {me && <PlayerPanel />}
    </>
  );
}

function JoinForm({ prefill }: { prefill: string }) {
  const { me, setMe } = useApp();
  const [code, setCode] = useState(prefill);
  const [name, setName] = useState(() => store.get<string>("nickname") ?? "");
  const { busy, error, setError, run } = useAction();
  useEffect(() => setCode(prefill), [prefill]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const c = code.toUpperCase();
          if (!/^[A-Z]{4}$/.test(c)) return setError("Enter the 4-letter code shown on the host screen.");
          if (!me) {
            const n = cleanName(name);
            if (!n) return setError("Enter your name so the host can see you on the leaderboard.");
            const r = await api.register(n);
            store.set("nickname", r.player.nickname);
            setMe(r.player);
          }
          const s = await api.gameJoin(c);
          store.set("room", s.game.id);
          navigate(s.role === "host" ? "/host/" + s.game.id : "/game/" + s.game.id);
        });
      }}
    >
      <label htmlFor="code">Game code</label>
      <input
        id="code"
        className="code"
        maxLength={4}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4))}
      />
      {!me && (
        <>
          <label htmlFor="n2">Your name</label>
          <input id="n2" maxLength={20} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} />
        </>
      )}
      {error && (
        <div className="note" role="alert">
          {error}
        </div>
      )}
      <button className="btn block" type="submit" disabled={busy}>
        {busy ? "Joining..." : "Join game"}
      </button>
    </form>
  );
}

function PlayerPanel() {
  const { me, setMe } = useApp();
  const [name, setName] = useState(me?.nickname ?? "");
  const { busy, error, run } = useAction();
  if (!me) return null;
  return (
    <details className="panel quiet">
      <summary>Your player: {me.nickname}</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const p = await api.rename(cleanName(name));
            store.set("nickname", p.nickname);
            setMe(p);
          });
        }}
      >
        <label htmlFor="rename">Change nickname</label>
        <div className="row">
          <input id="rename" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn alt" type="submit" disabled={busy || cleanName(name) === me.nickname}>
            Save
          </button>
        </div>
      </form>
      {error && (
        <div className="note" role="alert">
          {error}
        </div>
      )}
    </details>
  );
}
