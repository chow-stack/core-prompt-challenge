import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, kickGrader, supabase } from "./api.ts";
import type { Submission } from "./types.ts";

// ---------- Router (History API; Vercel rewrites every path to index.html) ----------
const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
}
export function navigate(to: string, replace = false) {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  listeners.forEach((fn) => fn());
  try {
    window.scrollTo(0, 0);
  } catch {
    /* ignore */
  }
}
export function useLocation(): { path: string; search: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  const u = new URL(href, location.origin);
  return { path: u.pathname.replace(/\/+$/, "") || "/", search: u.searchParams };
}

// ---------- Grading: poll grade_status and keep nudging the worker while queued (PLAN.md 3.1 step 4) ----------
const POLL_MS = 2500;
const KICK_MS = 6000;

export function useGrading(submissionId: string | null, onDone?: (s: Submission) => void) {
  const [sub, setSub] = useState<Submission | null>(null);
  const [error, setError] = useState("");
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!submissionId) {
      setSub(null);
      return;
    }
    let alive = true;
    let finished = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastKick = 0;
    let kicking = false;
    // One timer only: every reschedule clears the previous one, and tick never overlaps itself.
    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (alive && !finished) timer = setTimeout(tick, ms);
    };
    const kick = () => {
      if (kicking) return;
      kicking = true;
      lastKick = Date.now();
      kickGrader(submissionId).finally(() => {
        kicking = false;
        schedule(200);
      });
    };
    const tick = async () => {
      if (running || !alive || finished) return;
      running = true;
      try {
        const s = await api.gradeStatus(submissionId);
        if (!alive) return;
        setSub(s);
        setError("");
        if (s.status === "graded") {
          finished = true;
          done.current?.(s);
          return;
        }
        if (Date.now() - lastKick >= KICK_MS) kick();
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Connection problem. Retrying...");
      } finally {
        running = false;
      }
      schedule(POLL_MS + Math.random() * 600);
    };
    kick();
    tick();
    const onFocus = () => schedule(0);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [submissionId]);

  return { sub, error };
}

// ---------- Realtime with a polling fallback ----------
/**
 * Calls `refresh` when a Realtime change arrives on table/filter, every `fallbackMs`, and on focus/online.
 * `refresh` should be cheap and idempotent.
 */
export function useLiveRefresh(table: "games" | "board_ticks", filter: string | null, refresh: () => void, fallbackMs = 5000) {
  const fn = useRef(refresh);
  fn.current = refresh;
  useEffect(() => {
    if (!filter) return;
    const run = () => fn.current();
    const channel = supabase
      .channel(`${table}:${filter}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, run)
      .subscribe();
    const t = setInterval(run, fallbackMs);
    window.addEventListener("focus", run);
    window.addEventListener("online", run);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(t);
      window.removeEventListener("focus", run);
      window.removeEventListener("online", run);
    };
  }, [table, filter, fallbackMs]);
}

// ---------- Clock synced to the server (countdowns) ----------
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function secondsLeft(endsAt: string | null, offsetMs: number, now: number): number | null {
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((Date.parse(endsAt) - (now + offsetMs)) / 1000));
}

export function formatClock(s: number): string {
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/** Run an async action with busy/error state, ignoring double submits. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inflight = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
