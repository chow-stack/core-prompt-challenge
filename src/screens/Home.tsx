import { useEffect, useRef, useState } from "react";
import { cleanName } from "../../shared/scoring.ts";
import { api, store } from "../api.ts";
import { CoreCards } from "../components/CoreCards.tsx";
import { RecoveryDialog, RegisterForm } from "../components/Identity.tsx";
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
        Six real student scenarios. Write a prompt for each, and get graded on Context, Output, Rules, and Examples.
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
        <p>Go through all six scenarios on your own, any time. Your best score on each counts toward the club leaderboard.</p>
        {me === undefined ? (
          <p className="muted">Loading...</p>
        ) : me ? (
          <>
            <p className="muted tight">Playing as <b>{me.nickname}</b>.</p>
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
        <h2>Leaderboard</h2>
        <p>See who has the best prompts this season. Finish all six scenarios to get ranked.</p>
        <button className="btn alt block" type="button" onClick={() => navigate("/board")}>
          View the leaderboard
        </button>
      </section>

      {me?.is_admin && (
        <section className="panel">
          <h2>Hosting?</h2>
          <p>Run a live round for the whole club. You will get a join code, a QR code, and a live leaderboard.</p>
          <button className="btn alt block" type="button" onClick={() => navigate("/host")}>
            Host a game
          </button>
          <button className="btn alt block" type="button" onClick={() => navigate("/admin")}>
            Admin
          </button>
        </section>
      )}

      {me ? <PlayerPanel /> : me === null && <RecoverLink />}
    </>
  );
}

function RecoverLink() {
  return (
    <p className="center muted">
      Played before on another device?{" "}
      <a href="/recover" onClick={(e) => (e.preventDefault(), navigate("/recover"))}>
        Recover your player
      </a>
    </p>
  );
}

function JoinForm({ prefill }: { prefill: string }) {
  const { me, setMe } = useApp();
  const [code, setCode] = useState(prefill);
  const [pending, setPending] = useState<{ code: string; then: string; player: NonNullable<typeof me> } | null>(null);
  const [name, setName] = useState(() => store.get<string>("nickname") ?? "");
  const { busy, error, setError, run } = useAction();
  const join = () =>
    run(async () => {
      const c = code.toUpperCase();
      if (!/^[A-Z]{4}$/.test(c)) return setError("Enter the 4-letter code shown on the host screen.");
      if (!me) {
        const n = cleanName(name);
        if (!n) return setError("Enter your name so the host can see you on the leaderboard.");
        const r = await api.register(n);
        store.set("nickname", r.player.nickname);
        setPending({ code: r.recovery_code, then: c, player: r.player });
        return;
      }
      await enter(c);
    });
  const enter = async (c: string) => {
    const s = await api.gameJoin(c);
    store.set("room", s.game.id);
    navigate(s.role === "host" ? "/host/" + s.game.id : "/game/" + s.game.id);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        join();
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
        inputMode="text"
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
      {pending && (
        <RecoveryDialog
          code={pending.code}
          onClose={() => {
            setMe(pending.player);
            run(() => enter(pending.then));
          }}
        />
      )}
    </form>
  );
}

function PlayerPanel() {
  const { me, setMe } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(me?.nickname ?? "");
  const [code, setCode] = useState("");
  const { busy, error, run } = useAction();
  if (!me) return null;
  return (
    <details className="panel quiet" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
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
      <p className="muted">Lost your recovery code? Make a new one. The old code stops working.</p>
      <button className="btn alt" type="button" disabled={busy} onClick={() => run(async () => setCode((await api.rotateCode()).recovery_code))}>
        New recovery code
      </button>
      {error && (
        <div className="note" role="alert">
          {error}
        </div>
      )}
      {code && <RecoveryDialog code={code} onClose={() => setCode("")} />}
    </details>
  );
}
