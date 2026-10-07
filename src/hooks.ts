import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { errorText, supabase } from "./api.ts";

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
      setError(errorText(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
