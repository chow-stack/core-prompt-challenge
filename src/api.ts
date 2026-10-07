// Supabase client and typed RPC helpers. Only the publishable key reaches the browser.
import { createClient } from "@supabase/supabase-js";
import type { AdminStats, Board, GameState, Player, Progress, Scenario, Season, Submission } from "./types.ts";

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

let authPromise: Promise<void> | null = null;

/** Ensure an (anonymous) session exists. Shared so parallel callers sign in once. */
export function auth(): Promise<void> {
  authPromise ??= (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      throw new Error(
        /disabled/i.test(error.message)
          ? "Sign-in is turned off on the server. Ask a club leader to enable anonymous sign-ins in Supabase."
          : "Could not connect. Check your internet and try again.",
      );
    }
  })().catch((e) => {
    authPromise = null;
    throw e;
  });
  return authPromise;
}

/** Call an RPC and return its data, throwing a plain-English Error (RPC messages are written for players). */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  await auth();
  const { data, error } = await supabase.rpc(fn, args);
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
  register: (nickname: string) => rpc<{ player: Player; recovery_code: string }>("register_player", { nickname }),
  rename: (nickname: string) => rpc<Player>("rename_player", { nickname }),
  recover: (nickname: string, code: string) => rpc<Player>("recover_player", { nickname, code }),
  rotateCode: () => rpc<{ recovery_code: string }>("rotate_recovery_code"),
  scenarios: () => rpc<Scenario[]>("list_scenarios"),
  submit: (scenario_id: number, prompt: string, game_id: string | null = null) =>
    rpc<{ submission_id: string; status: string }>("submit_prompt", { scenario_id, prompt, game_id }),
  gradeStatus: (submission_id: string) => rpc<Submission>("grade_status", { submission_id }),
  progress: (season_id: string | null = null) => rpc<Progress>("my_progress", { season_id }),
  leaderboard: (season_id: string | null = null, game_id: string | null = null) => rpc<Board>("leaderboard", { season_id, game_id }),
  seasons: () => rpc<Season[]>("season_list"),
  claimAdmin: (passphrase: string) => rpc<Player>("claim_admin", { passphrase }),
  gameCreate: (timer_seconds: number) => rpc<GameState>("game_create", { timer_seconds }),
  gameJoin: (code: string) => rpc<GameState>("game_join", { code }),
  gameState: (game_id: string) => rpc<GameState>("game_state", { game_id }),
  gameAdvance: (game_id: string) => rpc<GameState>("game_advance", { game_id }),
  gameEnd: (game_id: string) => rpc<GameState>("game_end", { game_id }),
  adminStats: () => rpc<AdminStats>("admin_stats"),
  adminSet: (key: string, value: unknown) => rpc<AdminStats>("admin_set_setting", { key, value }),
  adminNewSeason: (name: string) => rpc<AdminStats>("admin_new_season", { name }),
  adminRegrade: () => rpc<AdminStats>("admin_regrade_estimates"),
  adminPlayers: (search: string) => rpc<{ id: string; nickname: string; is_admin: boolean; created_at: string; submissions: number }[]>("admin_players", { search }),
  adminRemovePlayer: (player_id: string) => rpc<AdminStats>("admin_remove_player", { player_id }),
  adminEndRoom: (game_id: string) => rpc<AdminStats>("admin_end_room", { game_id }),
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
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}
