// Ports of coreCards / miniCards / scoreCards / scenarioBlock from the prototype.
import { LETTERS, LMETA, SC_COUNT } from "../../shared/scoring.ts";
import type { Scenario } from "../types.ts";

export function CoreCards() {
  return (
    <div className="core">
      {LETTERS.map((k) => (
        <div key={k} className={"cc " + k}>
          <div className="ltr">{LMETA[k].k}</div>
          <div className="nm">{LMETA[k].n}</div>
          <div className="ds">{LMETA[k].d}</div>
        </div>
      ))}
    </div>
  );
}

export function MiniCards() {
  return (
    <div className="core">
      {LETTERS.map((k) => (
        <div key={k} className={"cc mini " + k}>
          <div className="ltr">{LMETA[k].k}</div>
          <div className="nm">{LMETA[k].n}</div>
        </div>
      ))}
    </div>
  );
}

export function ScoreCards({ res }: { res: { c: number; o: number; r: number; e: number } }) {
  return (
    <div className="core">
      {LETTERS.map((k) => (
        <div key={k} className={"cc " + k}>
          <div className="top">
            <div className="ltr">{LMETA[k].k}</div>
            <div className="sc">{res[k]}</div>
          </div>
          <div className="nm">{LMETA[k].n}</div>
          <div className="bar" role="img" aria-label={`${LMETA[k].n}: ${res[k]} out of 100`}>
            <i ref={(el) => void (el && (el.style.width = res[k] + "%"))} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ScenarioBlock({ s }: { s: Scenario }) {
  return (
    <>
      <div className="lbl">
        Scenario {s.position + 1} of {SC_COUNT}
      </div>
      <h2>{s.title}</h2>
      <p>{s.situation}</p>
      <p>
        <b>Your goal:</b> {s.goal}
      </p>
    </>
  );
}

/** Thin bar; width set through the DOM so the strict CSP (no inline style attributes) is respected. */
export function Bar({ pct, className = "progress" }: { pct: number; className?: string }) {
  return (
    <div className={className} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i ref={(el) => void (el && (el.style.width = Math.max(0, Math.min(100, pct)) + "%"))} />
    </div>
  );
}
