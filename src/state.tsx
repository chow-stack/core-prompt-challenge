import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, auth, errorText, kickGrader, store } from "./api.ts";
import type { Player, Scenario, Submission } from "./types.ts";

export type Toast = { id: string; submission: Submission };

type Ctx = {
  /** undefined while loading, null when this device has no player yet. */
  me: Player | null | undefined;
  setMe: (p: Player | null) => void;
  scenarios: Scenario[];
  bootError: string;
  reload: () => void;
  /** Latest known state of every submission this tab is tracking or has seen graded. */
  subs: Record<string, Submission>;
  /** Start grading a submission in the background (survives navigation and reloads). */
  track: (id: string) => void;
  pendingIds: string[];
  /** Bumps whenever a tracked submission finishes grading; screens use it to refetch. */
  gradedTick: number;
  toasts: Toast[];
  dismissToast: (id: string) => void;
};

const AppCtx = createContext<Ctx | null>(null);

const POLL_MS = 2500;
const KICK_MS = 6000;

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Player | null | undefined>(undefined);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [bootError, setBootError] = useState("");
  const [subs, setSubs] = useState<Record<string, Submission>>({});
  const [pendingIds, setPendingIds] = useState<string[]>(() => store.get<string[]>("pending") ?? []);
  const [gradedTick, setGradedTick] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastKick = useRef<Record<string, number>>({});

  const load = useCallback(() => {
    setBootError("");
    auth()
      .then(() => Promise.all([api.me(), api.scenarios()]))
      .then(([p, s]) => {
        setMe(p);
        setScenarios(s);
      })
      .catch((e) => {
        setMe(null);
        setBootError(errorText(e));
      });
  }, []);
  useEffect(load, [load]);

  const track = useCallback((id: string) => {
    setPendingIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }, []);
  useEffect(() => store.set("pending", pendingIds), [pendingIds]);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // One background loop grades everything in flight: poll status, nudge the worker every 6 s while queued.
  useEffect(() => {
    if (!pendingIds.length || !me) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const done: Submission[] = [];
      const gone: string[] = [];
      await Promise.all(
        pendingIds.map(async (id) => {
          try {
            const s = await api.gradeStatus(id);
            if (!alive) return;
            setSubs((m) => ({ ...m, [id]: s }));
            if (s.status === "graded") done.push(s);
            else if (Date.now() - (lastKick.current[id] ?? 0) >= KICK_MS) {
              lastKick.current[id] = Date.now();
              void kickGrader(id);
            }
          } catch (e) {
            // A submission that no longer exists (or belongs to another device) stops being tracked.
            if (errorText(e) === "Submission not found.") gone.push(id);
          }
        }),
      );
      if (!alive) return;
      if (done.length || gone.length) {
        const finished = new Set([...done.map((s) => s.id), ...gone]);
        setPendingIds((ids) => ids.filter((x) => !finished.has(x)));
        if (done.length) {
          setGradedTick((n) => n + 1);
          setToasts((t) => [...t, ...done.map((s) => ({ id: s.id, submission: s }))].slice(-3));
        }
      }
      timer = setTimeout(tick, POLL_MS + Math.random() * 600);
    };
    tick();
    const wake = () => {
      clearTimeout(timer);
      tick();
    };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [pendingIds, me]);

  return (
    <AppCtx.Provider
      value={{ me, setMe, scenarios, bootError, reload: load, subs, track, pendingIds, gradedTick, toasts, dismissToast }}
    >
      {children}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppProvider missing");
  return c;
}

/** Track one submission and return its latest state (fetched once if it was graded before this tab saw it). */
export function useSubmission(id: string | null): Submission | null {
  const { subs, track } = useApp();
  const [fetched, setFetched] = useState<Submission | null>(null);
  useEffect(() => {
    setFetched(null);
    if (!id) return;
    let alive = true;
    api.gradeStatus(id).then(
      (s) => {
        if (!alive) return;
        setFetched(s);
        if (s.status !== "graded") track(id);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [id, track]);
  if (!id) return null;
  return subs[id] ?? fetched;
}
