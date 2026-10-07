// Public season leaderboard: ranked (all six scored) then "In progress". Live via board_ticks + polling.
import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../api.ts";
import { LeaderboardTable } from "../components/LeaderboardTable.tsx";
import { navigate, useLiveRefresh } from "../hooks.ts";
import { useApp } from "../state.tsx";
import type { Board as BoardData, Season } from "../types.ts";

export function Board({ seasonParam }: { seasonParam: string | null }) {
  const { me } = useApp();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [error, setError] = useState("");
  const seasonId = seasonParam ?? seasons.find((s) => s.status === "active")?.id ?? null;

  useEffect(() => {
    api.seasons().then(setSeasons, (e) => setError(errorText(e)));
  }, []);
  const refresh = useCallback(() => {
    if (!seasons.length) return;
    api.leaderboard(seasonId).then(
      (b) => (setBoard(b), setError("")),
      (e) => setError(errorText(e)),
    );
  }, [seasonId, seasons.length]);
  useEffect(refresh, [refresh]);
  const live = board?.season?.status === "active";
  useLiveRefresh("board_ticks", live && seasonId ? "scope=eq.season:" + seasonId : null, refresh, 15000);

  const rank = board?.my_rank;
  return (
    <div className="wide-board">
      <h1>Leaderboard</h1>
      <p className="lead">
        Your season score is the sum of your best score on each of the six scenarios, out of 600. Finish all six to get ranked.
      </p>
      {seasons.length > 1 && (
        <div className="season-pick">
          <label htmlFor="season">Season</label>
          <select id="season" value={seasonId ?? ""} onChange={(e) => navigate("/board?season=" + e.target.value, true)}>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.status === "active" ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && (
        <div className="note" role="alert">
          {error}
        </div>
      )}
      {!board ? (
        !error && <p className="muted">Loading the leaderboard...</p>
      ) : (
        <>
          <h2>
            {board.season?.name}
            {board.season?.status === "archived" ? " (final)" : ""}
          </h2>
          {me && rank ? <p className="muted">You are ranked #{rank}.</p> : null}
          <LeaderboardTable rows={board.ranked} maxTotal={600} empty="Nobody has finished all six scenarios yet. Be the first." />
          {board.in_progress.length > 0 && (
            <>
              <h2 className="gap">In progress</h2>
              <p className="muted">Players who have not scored on all six scenarios yet.</p>
              <LeaderboardTable rows={board.in_progress} showRank={false} />
            </>
          )}
          <p className="muted small">~ means a quick estimate, used when the AI grader was busy.</p>
        </>
      )}
      <button className="btn block" type="button" onClick={() => navigate(me ? "/play" : "/")}>
        {me ? "Play" : "Start playing"}
      </button>
    </div>
  );
}
