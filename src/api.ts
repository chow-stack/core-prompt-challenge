// Supabase client and typed RPC helpers. Only the publishable key reaches the browser.
import { createClient } from "@supabase/supabase-js";
import type { Board, GameState, Player, Progress, Scenario, Season, Submission } from "./types.ts";

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

let signingIn: Promise<void> | null = null;

/**
 * Ensure an (anonymous) session exists. Checked on every call (getSession is local and cheap) so a session that was
 * cleared or expired is replaced instead of failing forever. Parallel callers share one sign-in.
 */
export async function auth(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  signingIn ??= (async () => {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      throw new Error(
        /disabled/i.test(error.message)
          ? "Sign-in is turned off on the server. Ask a club leader to enable anonymous sign-ins in Supabase."
          : /rate limit|too many/i.test(error.message)
            ? "Too many people are signing in from this network right now. Wait a minute and try again."
            : "Could not connect. Check your internet and try again.",
      );
    }
  })().finally(() => {
    signingIn = null;
  });
  return signingIn;
}

/** True when the request failed because the session is missing, expired, or belongs to a deleted user. */
function isAuthError(e: { code?: string; message?: string }): boolean {
  return e.code === "42501" || e.code === "PGRST301" || /JWT|sub claim|not authenticated/i.test(e.message ?? "");
}

/** Call an RPC and return its data, throwing a plain-English Error (RPC messages are written for players). */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  await auth();
  let { data, error } = await supabase.rpc(fn, args);
  if (error && isAuthError(error)) {
    // Stale or missing session: start a fresh anonymous one and retry once.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    await auth();
    ({ data, error } = await supabase.rpc(fn, args));
  }
  if (error) {
    const msg = error.message || "";
    // Server errors raised by our functions are already friendly; hide anything that looks internal.
    const friendly = msg && !/(violates|syntax|function .* does not exist|permission denied|JWT|relation )/i.test(msg);
    throw new Error(friendly ? msg : "Something went wrong. Try again.");
  }
  return data as T;
}

export const api = {
  me: () => rpc<Player | null>("me"),
  register: (nickname: string) => rpc<{ player: Player }>("register_player", { nickname }),
  rename: (nickname: string) => rpc<Player>("rename_player", { nickname }),
  scenarios: () => rpc<Scenario[]>("list_scenarios"),
  submit: (scenario_id: number, prompt: string, game_id: string | null = null) =>
    rpc<{ submission_id: string; status: string }>("submit_prompt", { scenario_id, prompt, game_id }),
  gradeStatus: (submission_id: string) => rpc<Submission>("grade_status", { submission_id }),
  progress: (season_id: string | null = null) => rpc<Progress>("my_progress", { season_id }),
  leaderboard: (season_id: string | null = null, game_id: string | null = null) => rpc<Board>("leaderboard", { season_id, game_id }),
  seasons: () => rpc<Season[]>("season_list"),
  gameCreate: (timer_seconds: number) => rpc<GameState>("game_create", { timer_seconds }),
  gameJoin: (code: string) => rpc<GameState>("game_join", { code }),
  gameState: (game_id: string) => rpc<GameState>("game_state", { game_id }),
  gameAdvance: (game_id: string) => rpc<GameState>("game_advance", { game_id }),
  gameEnd: (game_id: string) => rpc<GameState>("game_end", { game_id }),
  myHostedGame: () => rpc<{ id: string; code: string; phase: string } | null>("my_hosted_game"),
};

/** Nudge the grader for this submission. Safe to call repeatedly; failures are ignored (polling continues). */
export async function kickGrader(submission_id: string): Promise<void> {
  try {
    await auth();
    await supabase.functions.invoke("grade-prompt", { body: { submission_id } });
  } catch {
    /* the next poll retries */
  }
}

// ---------- localStorage (always wrapped: private mode and blocked storage must not break the app) ----------
export const store = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem("cpc:" + k);
      return v == null ? null : (JSON.parse(v) as T);
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem("cpc:" + k, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
  del(k: string): void {
    try {
      localStorage.removeItem("cpc:" + k);
    } catch {
      /* ignore */
    }
  },
};

export function errorText(e: unknown): string {
  if (e instanceof TypeError || (e instanceof Error && /failed to fetch|network|load failed/i.test(e.message)))
    return "Could not connect. Check your internet and try again.";
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}
