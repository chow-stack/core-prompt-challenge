// Nickname registration. A player is tied to this browser (anonymous Supabase session).
import { useState } from "react";
import { cleanName } from "../../shared/scoring.ts";
import { api, store } from "../api.ts";
import { useAction } from "../hooks.ts";
import { useApp } from "../state.tsx";
import type { Player } from "../types.ts";

/** Nickname form. Calls onReady(player) once registered. */
export function RegisterForm({ id, cta, onReady }: { id: string; cta: string; onReady: (p: Player) => void }) {
  const { setMe } = useApp();
  const [name, setName] = useState(() => store.get<string>("nickname") ?? "");
  const { busy, error, setError, run } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const n = cleanName(name);
          if (!n) return setError("Enter a nickname so you show up on the leaderboard.");
          const r = await api.register(n);
          store.set("nickname", r.player.nickname);
          setMe(r.player);
          onReady(r.player);
        });
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
  );
}
