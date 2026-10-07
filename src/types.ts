export type Player = { id: string; nickname: string };

export type Scenario = { id: number; position: number; title: string; situation: string; goal: string };

export type Submission = {
  id: string;
  scenario_id: number;
  game_id: string | null;
  attempt_no: number;
  is_live: boolean;
  status: "queued" | "grading" | "graded";
  prompt: string;
  c: number | null;
  o: number | null;
  r: number | null;
  e: number | null;
  quality: number | null;
  accuracy: number | null;
  habits: number | null;
  percent: number | null;
  strength: string | null;
  fix: string | null;
  graded_by: string | null;
  is_estimate: boolean;
  created_at: string;
  graded_at: string | null;
  queue_position: number;
};

/** A submission that has scores. */
export type Graded = Submission & { status: "graded"; c: number; o: number; r: number; e: number; percent: number };

export type ScenarioProgress = {
  scenario_id: number;
  position: number;
  attempts_used: number;
  attempts_left: number;
  best: Submission | null;
  latest: Submission | null;
};

export type Progress = {
  season_id: string;
  season_active: boolean;
  play_open: boolean;
  daily_left: number;
  scenarios: ScenarioProgress[];
  total: number;
};

export type BoardRow = {
  rank: number | null;
  nickname: string;
  scores: (number | null)[];
  estimates: boolean[];
  total: number;
  completed: boolean;
  is_me: boolean;
  has_estimate: boolean;
};

export type Board = {
  season?: { id: string; name: string; status: "active" | "archived" };
  ranked: BoardRow[];
  in_progress: BoardRow[];
  my_rank?: number | null;
};

export type Season = { id: string; name: string; status: "active" | "archived"; started_at: string; ended_at: string | null };

export type GameState = {
  game: {
    id: string;
    code: string;
    phase: "lobby" | "playing" | "finished";
    scenario_idx: number;
    scenario_ends_at: string | null;
    timer_seconds: number;
    revision: number;
    expires_at: string;
    host_nickname: string;
    season_id: string;
  };
  role: "host" | "player";
  me: string | null;
  scenario: Scenario | null;
  player_count: number;
  submitted: number;
  players: { id: string; nickname: string; is_me: boolean }[];
  my_submissions: { scenario_id: number; submission_id: string; status: Submission["status"]; percent: number | null }[];
  server_time: string;
};

export function isGraded(s: Submission | null | undefined): s is Graded {
  return !!s && s.status === "graded" && s.percent != null;
}
