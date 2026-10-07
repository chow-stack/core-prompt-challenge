// Port of boardHTML, extended with the season rules: ranked rows, "~" for estimates, sticky name column on phones.
import { SC_COUNT } from "../../shared/scoring.ts";
import type { BoardRow } from "../types.ts";

export function LeaderboardTable({
  rows,
  current = -1,
  showRank = true,
  maxTotal,
  empty = "No players yet. Scores appear here as prompts are graded.",
}: {
  rows: BoardRow[];
  current?: number;
  showRank?: boolean;
  maxTotal?: number;
  empty?: string;
}) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <div className="scroll board">
      <table>
        <thead>
          <tr>
            {showRank && <th className="rk">#</th>}
            <th className="who">Player</th>
            {Array.from({ length: SC_COUNT }, (_, i) => (
              <th key={i} className={"n" + (i === current ? " cur" : "")} title={`Scenario ${i + 1}`}>
                {i + 1}
              </th>
            ))}
            <th className="n">Total{maxTotal ? ` /${maxTotal}` : ""}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, k) => (
            <tr key={p.nickname + k} className={p.is_me ? "me" : undefined}>
              {showRank && <td className="rk">{p.rank ?? k + 1}</td>}
              <td className="who">
                {p.nickname}
                {p.is_me ? " (you)" : ""}
              </td>
              {p.scores.map((v, i) => (
                <td key={i} className={"n cell" + (i === current ? " cur" : "")}>
                  {v == null ? "-" : (p.estimates[i] ? "~" : "") + v}
                </td>
              ))}
              <td className="n">
                <b>
                  {p.has_estimate ? "~" : ""}
                  {p.total}
                </b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
