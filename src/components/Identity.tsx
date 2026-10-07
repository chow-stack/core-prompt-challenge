// Nickname registration, the one-time recovery-code dialog, and device recovery.
import { useEffect, useRef, useState } from "react";
import { cleanName } from "../../shared/scoring.ts";
import { api, store } from "../api.ts";
import { navigate, useAction } from "../hooks.ts";
import { useApp } from "../state.tsx";
import type { Player } from "../types.ts";

export function RecoveryDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("Copied");
    } catch {
      setCopied("Select the code and copy it");
    }
    setTimeout(() => setCopied(""), 1800);
  };
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="rc-title"
      onCancel={(e) => {
        // Escape must not dismiss before the player confirms they saved the code.
        if (!saved) e.preventDefault();
      }}
    >
      <h2 id="rc-title">Save your recovery code</h2>
      <p>
        This code lets you get back to your scores on another phone or browser. It is shown <b>only once</b>.
      </p>
      <div className="recovery" aria-label="Recovery code">
        {code}
      </div>
      <div className="row">
        <button className="btn alt" type="button" onClick={copy}>
          {copied || "Copy code"}
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved it (screenshot or notes app)
      </label>
      <button
        className="btn block"
        type="button"
        disabled={!saved}
        onClick={() => {
          ref.current?.close();
          onClose();
        }}
      >
        Continue
      </button>
    </dialog>
  );
}

/** Nickname form. Calls onReady(player) once registered (after the recovery dialog is dismissed). */
export function RegisterForm({ id, cta, onReady }: { id: string; cta: string; onReady: (p: Player) => void }) {
  const { setMe } = useApp();
  const [name, setName] = useState(() => store.get<string>("nickname") ?? "");
  const [pending, setPending] = useState<{ player: Player; code: string } | null>(null);
  const { busy, error, setError, run } = useAction();
  const submit = () =>
    run(async () => {
      const n = cleanName(name);
      if (!n) {
        setError("Enter a nickname so you show up on the leaderboard.");
        return;
      }
      const r = await api.register(n);
      store.set("nickname", r.player.nickname);
      setPending({ player: r.player, code: r.recovery_code });
    });
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={id}>Your name</label>
        <input
          id={id}
          maxLength={20}
          autoComplete="nickname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-describedby={id + "-hint"}
        />
        <p className="muted tight" id={id + "-hint"}>
          Shown on the leaderboard. 20 characters max.
        </p>
        {error && (
          <div className="note" role="alert">
            {error}
          </div>
        )}
        <button className="btn block" type="submit" disabled={busy}>
          {busy ? "One moment..." : cta}
        </button>
      </form>
      {pending && (
        <RecoveryDialog
          code={pending.code}
          onClose={() => {
            setMe(pending.player);
            onReady(pending.player);
          }}
        />
      )}
    </>
  );
}

export function RecoverForm() {
  const { setMe } = useApp();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const p = await api.recover(cleanName(name), code);
          store.set("nickname", p.nickname);
          setMe(p);
          navigate("/");
        });
      }}
    >
      <label htmlFor="rn">Nickname</label>
      <input id="rn" maxLength={20} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="rcode">Recovery code</label>
      <input
        id="rcode"
        className="code-sm"
        maxLength={9}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="XXXX-XXXX"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      {error && (
        <div className="note" role="alert">
          {error}
        </div>
      )}
      <button className="btn block" type="submit" disabled={busy || !name.trim() || code.replace(/[^A-Z0-9]/gi, "").length !== 8}>
        {busy ? "Checking..." : "Recover my player"}
      </button>
    </form>
  );
}
