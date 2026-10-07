// Club-leader controls. Every action is re-checked server-side (players.is_admin); the UI is only convenience.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { RegisterForm } from "../components/Identity.tsx";
import { navigate, useAction } from "../hooks.ts";
import { useApp } from "../state.tsx";
import type { AdminStats } from "../types.ts";

export function Admin() {
  const { me, setMe } = useApp();
  const [pass, setPass] = useState("");
  const claim = useAction();

  if (me === undefined) return <p className="muted">Loading...</p>;
  if (me === null)
    return (
      <>
        <h1>Admin</h1>
        <p className="lead">Pick a nickname first. Admin access is tied to your player.</p>
        <section className="panel">
          <RegisterForm id="an" cta="Continue" onReady={() => {}} />
        </section>
      </>
    );
  if (!me.is_admin)
    return (
      <>
        <h1>Admin</h1>
        <section className="panel">
          <h2>Club leader access</h2>
          <p>Enter the admin passphrase the club leaders share.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              claim.run(async () => setMe(await api.claimAdmin(pass)));
            }}
          >
            <label htmlFor="pass">Passphrase</label>
            <input id="pass" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
            {claim.error && (
              <div className="note" role="alert">
                {claim.error}
              </div>
            )}
            <button className="btn block" type="submit" disabled={claim.busy || !pass}>
              Unlock
            </button>
          </form>
        </section>
      </>
    );
  return <AdminPanel />;
}

const LIMITS: [string, string][] = [
  ["rpm_limit", "Calls per minute, per model"],
  ["rpd_limit", "Calls per day, per model"],
  ["solo_daily_cap", "Daily calls for solo play (all models)"],
  ["player_daily_cap", "Solo prompts per player per day"],
  ["queue_timeout_s", "Seconds in line before a quick estimate"],
];

function AdminPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [season, setSeason] = useState("");
  const [confirmSeason, setConfirmSeason] = useState(false);
  const [search, setSearch] = useState("");
  const [players, setPlayers] = useState<Awaited<ReturnType<typeof api.adminPlayers>>>([]);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [flash, setFlash] = useState("");
  const act = useAction();
  const load = useCallback(() => {
    api.adminStats().then(setStats, () => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (!stats) return <p className="muted">Loading admin stats...</p>;
  const st = stats.settings;
  const mode = String(st.grader_mode);
  const models = (st.models as string[]) ?? [];
  const rpm = Number(st.rpm_limit), rpd = Number(st.rpd_limit);
  const callsFor = (m: string) => stats.calls.find((c) => c.model === m) ?? { today: 0, last_minute: 0, failed_today: 0 };
  const apply = (p: Promise<AdminStats>, msg: string) =>
    act.run(async () => {
      const s = await p;
      setStats(s);
      setFlash(msg + (s.requeued != null ? ` (${s.requeued} queued)` : ""));
      setTimeout(() => setFlash(""), 4000);
    });

  return (
    <>
      <h1>Admin</h1>
      <p className="lead">
        Season: <b>{stats.season?.name ?? "none"}</b>. {stats.players} players.
      </p>
      <div className="row wrap">
        <button className="btn" type="button" onClick={() => navigate("/host")}>
          Host a game
        </button>
        <button className="btn alt" type="button" onClick={() => navigate("/board")}>
          Leaderboard
        </button>
      </div>
      {act.error && (
        <div className="note" role="alert">
          {act.error}
        </div>
      )}
      {flash && (
        <div className="note ok" role="status">
          {flash}
        </div>
      )}

      <section className="panel">
        <h2>Grader quota today</h2>
        <p className="muted">Resets at midnight Pacific. Ceilings are the app&rsquo;s safety margins, below Google&rsquo;s limits.</p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th className="n">Last minute</th>
                <th className="n">Today</th>
                <th className="n">Failed</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const c = callsFor(m);
                return (
                  <tr key={m}>
                    <td>{m}</td>
                    <td className="n">
                      {c.last_minute} / {rpm}
                    </td>
                    <td className="n">
                      {c.today} / {rpd}
                    </td>
                    <td className="n">{c.failed_today}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p>
          In line now: <b>{stats.queue_length}</b>. Graded today: <b>{stats.graded_today}</b>. Estimates this season:{" "}
          <b>{stats.estimates}</b>
          {stats.regrade_pending ? (
            <>
              {" "}
              (regrading <b>{stats.regrade_pending}</b>)
            </>
          ) : null}
          .
        </p>
        <button
          className="btn alt"
          type="button"
          disabled={act.busy || !stats.estimates || mode !== "gemini"}
          onClick={() => apply(api.adminRegrade(), "Estimates queued for regrading")}
        >
          Regrade estimates
        </button>
      </section>

      <section className="panel">
        <h2>Grader mode</h2>
        <fieldset className="choices">
          <legend className="sr-only">Grader mode</legend>
          {[
            ["gemini", "Gemini", "Real AI grading (default)."],
            ["estimate", "Estimate only", "Never call Gemini. Keyword scores, marked with ~."],
            ["mock", "Mock", "Fake deterministic scores for load tests. Do not use with players."],
          ].map(([v, label, hint]) => (
            <label key={v} className="choice">
              <input type="radio" name="mode" checked={mode === v} disabled={act.busy} onChange={() => apply(api.adminSet("grader_mode", v), "Mode set to " + label)} />{" "}
              <b>{label}</b> <span className="muted">{hint}</span>
            </label>
          ))}
        </fieldset>
        <h3>Solo play</h3>
        <label className="choice">
          <input
            type="checkbox"
            checked={st.play_open === true}
            disabled={act.busy}
            onChange={(e) => apply(api.adminSet("play_open", e.target.checked), e.target.checked ? "Play opened" : "Play closed")}
          />{" "}
          Open for solo play (live rooms always work)
        </label>
      </section>

      <section className="panel">
        <h2>Limits</h2>
        {LIMITS.map(([k, label]) => (
          <LimitRow key={k} k={k} label={label} value={Number(st[k])} busy={act.busy} onSave={(v) => apply(api.adminSet(k, v), "Saved")} />
        ))}
      </section>

      <section className="panel">
        <h2>Live rooms</h2>
        {stats.rooms.length === 0 ? (
          <p className="muted">No open rooms.</p>
        ) : (
          <ul className="plain">
            {stats.rooms.map((r) => (
              <li key={r.id} className="row between">
                <span>
                  <b>{r.code}</b> by {r.host}, {r.players} players, {r.phase === "lobby" ? "lobby" : `scenario ${r.scenario_idx + 1}`}
                </span>
                <button className="btn alt sm" type="button" disabled={act.busy} onClick={() => apply(api.adminEndRoom(r.id), "Room ended")}>
                  End
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Players</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            act.run(async () => setPlayers(await api.adminPlayers(search)));
          }}
        >
          <label htmlFor="ps" className="sr-only">
            Search nicknames
          </label>
          <input id="ps" placeholder="Search nicknames" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn alt" type="submit">
            Search
          </button>
        </form>
        <ul className="plain">
          {players.map((p) => (
            <li key={p.id} className="row between">
              <span>
                {p.nickname} {p.is_admin && <span className="tag">admin</span>} <span className="muted">{p.submissions} prompts</span>
              </span>
              {confirmRemove === p.id ? (
                <span className="row">
                  <button
                    className="btn danger sm"
                    type="button"
                    onClick={() =>
                      act.run(async () => {
                        setStats(await api.adminRemovePlayer(p.id));
                        setPlayers((ps) => ps.filter((x) => x.id !== p.id));
                        setConfirmRemove(null);
                      })
                    }
                  >
                    Remove for good
                  </button>
                  <button className="btn alt sm" type="button" onClick={() => setConfirmRemove(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="btn alt sm" type="button" onClick={() => setConfirmRemove(p.id)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="muted small">Removing a player deletes their scores. Use it for inappropriate nicknames.</p>
      </section>

      <section className="panel">
        <h2>New season</h2>
        <p>Archives the current leaderboard (still viewable) and starts an empty one.</p>
        <label htmlFor="sn">Season name</label>
        <input id="sn" maxLength={40} placeholder="Spring 2027" value={season} onChange={(e) => setSeason(e.target.value)} />
        {confirmSeason ? (
          <div className="row">
            <button
              className="btn danger"
              type="button"
              disabled={act.busy}
              onClick={() =>
                act.run(async () => {
                  setStats(await api.adminNewSeason(season.trim()));
                  setSeason("");
                  setConfirmSeason(false);
                })
              }
            >
              Archive {stats.season?.name} and start {season.trim()}
            </button>
            <button className="btn alt" type="button" onClick={() => setConfirmSeason(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn alt" type="button" disabled={!season.trim()} onClick={() => setConfirmSeason(true)}>
            Start new season
          </button>
        )}
      </section>
    </>
  );
}

function LimitRow({ k, label, value, busy, onSave }: { k: string; label: string; value: number; busy: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const n = Number(v);
  return (
    <form
      className="limit"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(n);
      }}
    >
      <label htmlFor={k}>{label}</label>
      <div className="row">
        <input id={k} inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ""))} />
        <button className="btn alt" type="submit" disabled={busy || !n || n === value}>
          Save
        </button>
      </div>
    </form>
  );
}
