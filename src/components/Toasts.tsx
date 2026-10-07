// "Score is in" pop-ups for prompts graded in the background.
import { useEffect } from "react";
import { navigate } from "../hooks.ts";
import { useApp } from "../state.tsx";

const TTL_MS = 9000;

export function Toasts() {
  const { toasts, dismissToast, scenarios } = useApp();
  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => dismissToast(toasts[0].id), TTL_MS);
    return () => clearTimeout(t);
  }, [toasts, dismissToast]);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(({ id, submission: s }) => {
        const sc = scenarios.find((x) => x.id === s.scenario_id);
        const n = sc ? sc.position + 1 : s.scenario_id;
        return (
          <div key={id} className="toast">
            <div className="toast-pct">
              {s.is_estimate ? "~" : ""}
              {s.percent}%
            </div>
            <div className="toast-body">
              <b>Scenario {n} graded</b>
              <span>{sc?.title}</span>
            </div>
            {!s.is_live && (
              <button
                className="btn alt sm"
                type="button"
                onClick={() => {
                  dismissToast(id);
                  navigate("/play?s=" + n);
                }}
              >
                See result
              </button>
            )}
            <button className="toast-x" type="button" aria-label="Dismiss" onClick={() => dismissToast(id)}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
