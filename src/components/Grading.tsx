// Composer, grading wait state, result card, and summary (ports of composerHTML, gradingHTML, resultHTML, summaryHTML).
import { useEffect, useState } from "react";
import { LMETA, MAXLEN, SC_COUNT, graderLabel, summaryData } from "../../shared/scoring.ts";
import { store } from "../api.ts";
import type { Graded, Scenario, Submission } from "../types.ts";
import { MiniCards, ScoreCards } from "./CoreCards.tsx";

export function Composer({
  draftKey,
  note,
  busy,
  error,
  disabled,
  onSubmit,
}: {
  draftKey: string;
  note: string;
  busy: boolean;
  error: string;
  disabled?: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState(() => store.get<string>("draft:" + draftKey) ?? "");
  useEffect(() => setText(store.get<string>("draft:" + draftKey) ?? ""), [draftKey]);
  const change = (v: string) => {
    setText(v);
    store.set("draft:" + draftKey, v);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = text.trim();
        if (v && !busy && !disabled) onSubmit(v);
      }}
    >
      <label htmlFor="p">Your prompt</label>
      <textarea
        id="p"
        maxLength={MAXLEN}
        placeholder="Write the prompt you would type into the AI."
        value={text}
        onChange={(e) => change(e.target.value)}
        aria-describedby="cnt privacy"
      />
      <div className="counter" id="cnt" aria-live="polite">
        {text.length} / {MAXLEN}
      </div>
      <p className="muted tight">{note}</p>
      <p className="muted tight" id="privacy">
        Don&rsquo;t put personal info in your prompt. Prompts are graded by Google Gemini.
      </p>
      {error && <div className="note" role="alert">{error}</div>}
      {disabled && <div className="note">{disabled}</div>}
      <button className="btn block" type="submit" disabled={!text.trim() || busy || !!disabled}>
        {busy ? "Sending..." : "Grade my prompt"}
      </button>
      <h3>CORE reminder</h3>
      <MiniCards />
    </form>
  );
}

export function clearDraft(draftKey: string) {
  store.del("draft:" + draftKey);
}

export function GradingView({ sub, error }: { sub: Submission | null; error?: string }) {
  const ahead = sub?.queue_position ?? 0;
  return (
    <div aria-live="polite">
      <h3>Grading your prompt</h3>
      <div className="wait">
        <i />
      </div>
      {sub && sub.status === "queued" && ahead > 0 ? (
        <p className="muted">
          In line, about {ahead} prompt{ahead === 1 ? "" : "s"} ahead. Grading soon.
        </p>
      ) : (
        <p className="muted">Gemini is reading it against the CORE framework. This can take a few seconds.</p>
      )}
      {error && <p className="muted">{error}</p>}
    </div>
  );
}

function EstimateNote({ res }: { res: Submission }) {
  if (!res.is_estimate) return null;
  return (
    <div className="note">
      <b>Quick estimate.</b> The AI grader was busy or unavailable, so this score comes from keywords and prompt length.
      Treat it as a rough guide. A club leader can regrade it later.
    </div>
  );
}

export function ResultView({ res, label = "Your score for this scenario" }: { res: Graded; label?: string }) {
  return (
    <div className="result">
      <div className="scorehead">
        <div className="pct">
          {res.is_estimate ? "~" : ""}
          {res.percent}%
        </div>
        <div className="lbl">{label}</div>
      </div>
      <ScoreCards res={res} />
      <div className="fb">
        <h3>What worked</h3>
        <p>{res.strength}</p>
        <h3>Next time</h3>
        <p>{res.fix}</p>
      </div>
      <EstimateNote res={res} />
      {res.prompt && (
        <details>
          <summary>Your prompt</summary>
          <p>{res.prompt}</p>
        </details>
      )}
      {res.graded_by && <p className="graded-by">Graded by {graderLabel(res.graded_by)}</p>}
    </div>
  );
}

export function SummaryView({ scenarios, results }: { scenarios: Scenario[]; results: (Graded | null)[] }) {
  const d = summaryData(results);
  if (!d) return <p>No scenarios were graded.</p>;
  const wm = LMETA[d.weak];
  return (
    <>
      <div className="scorehead">
        <div className="pct">{d.percent}%</div>
        <div className="lbl">
          Average across {d.n} scenario{d.n > 1 ? "s" : ""}
        </div>
      </div>
      <ScoreCards res={d} />
      <div className="note">
        <b>
          Your weakest letter is {wm.k}, {wm.n}.
        </b>{" "}
        {wm.tip}
      </div>
      <h3>Your scores</h3>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th className="n">Score</th>
              <th className="n">C</th>
              <th className="n">O</th>
              <th className="n">R</th>
              <th className="n">E</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.slice(0, SC_COUNT).map((s, i) => {
              const r = results[i];
              return (
                <tr key={s.id}>
                  <td>
                    {i + 1}. {s.title}
                  </td>
                  {r ? (
                    <>
                      <td className="n">
                        <b>
                          {r.is_estimate ? "~" : ""}
                          {r.percent}%
                        </b>
                      </td>
                      <td className="n">{r.c}</td>
                      <td className="n">{r.o}</td>
                      <td className="n">{r.r}</td>
                      <td className="n">{r.e}</td>
                    </>
                  ) : (
                    <>
                      <td className="n">-</td>
                      <td className="n">-</td>
                      <td className="n">-</td>
                      <td className="n">-</td>
                      <td className="n">-</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
