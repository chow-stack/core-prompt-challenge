-- Core schema. Everything private lives in game_private (RLS on, no client grants).
-- Public tables hold only non-secret metadata needed for Realtime.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists game_private;
revoke all on schema game_private from public, anon;
grant usage on schema game_private to authenticated;

create table game_private.app_settings (key text primary key, value jsonb not null);

create table game_private.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  status text not null default 'active' check (status in ('active','archived')),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index seasons_one_active on game_private.seasons ((true)) where status = 'active';

create table game_private.scenarios (
  id int primary key,
  position int not null unique check (position between 0 and 5),
  title text not null, situation text not null, goal text not null,
  grader_notes text not null, must jsonb not null
);

create table game_private.banned_words (word text primary key);

create table game_private.players (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid unique not null,
  nickname text not null check (char_length(nickname) between 1 and 20),
  nickname_key text generated always as (lower(btrim(nickname))) stored unique,
  recovery_hash text,
  is_admin bool not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null check (code ~ '^[A-HJ-NP-Z]{4}$'),
  host_player_id uuid not null references game_private.players on delete cascade,
  season_id uuid not null references game_private.seasons,
  phase text not null default 'lobby' check (phase in ('lobby','playing','finished')),
  scenario_idx int not null default -1 check (scenario_idx between -1 and 6),
  scenario_ends_at timestamptz,
  timer_seconds int not null default 300 check (timer_seconds between 30 and 1800),
  revision int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);
create index on public.games (host_player_id);
create index on public.games (season_id);

create table game_private.game_players (
  game_id uuid not null references public.games on delete cascade,
  player_id uuid not null references game_private.players on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index on game_private.game_players (player_id);

create table game_private.submissions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references game_private.players on delete cascade,
  season_id uuid not null references game_private.seasons,
  game_id uuid references public.games on delete set null,
  scenario_id int not null references game_private.scenarios,
  attempt_no int not null check (attempt_no >= 1),
  is_live bool not null default false,
  prompt text not null check (char_length(prompt) between 1 and 1500),
  status text not null default 'queued' check (status in ('queued','grading','graded')),
  tries int not null default 0,
  retry_after timestamptz,
  regrade_requested bool not null default false,
  c int, o int, r int, e int, quality int, accuracy int, habits int, percent int check (percent between 0 and 100),
  strength text, fix text, graded_by text,
  is_estimate bool not null default false,
  created_at timestamptz not null default now(),
  queued_at timestamptz not null default now(),
  graded_at timestamptz,
  unique (player_id, season_id, scenario_id, attempt_no)
);
create unique index submissions_one_per_room on game_private.submissions (player_id, game_id, scenario_id) where game_id is not null;
create index on game_private.submissions (season_id, scenario_id, percent desc);
create index on game_private.submissions (status, queued_at);
create index on game_private.submissions (player_id, created_at);
create index on game_private.submissions (game_id);
create index on game_private.submissions (scenario_id);
create index submissions_regrade on game_private.submissions (queued_at) where regrade_requested;

-- Quota ledger: one row per model call. Mock-mode rows use model 'mock:<name>' so they never count against real quota.
create table game_private.grader_calls (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references game_private.submissions on delete set null,
  model text not null,
  status text not null default 'claimed' check (status in ('claimed','ok','failed')),
  http_status int, latency_ms int,
  created_at timestamptz not null default now()
);
create index on game_private.grader_calls (model, created_at);
create index on game_private.grader_calls (submission_id);
create index on game_private.grader_calls (created_at);

create table game_private.rate_limits (
  key text not null, window_start timestamptz not null, count int not null default 0,
  primary key (key, window_start)
);

-- Bumped when a submission is graded so boards refresh over Realtime without exposing submissions.
create table public.board_ticks (
  scope text primary key,
  updated_at timestamptz not null default now()
);

alter table game_private.app_settings enable row level security;
alter table game_private.seasons enable row level security;
alter table game_private.scenarios enable row level security;
alter table game_private.banned_words enable row level security;
alter table game_private.players enable row level security;
alter table game_private.game_players enable row level security;
alter table game_private.submissions enable row level security;
alter table game_private.grader_calls enable row level security;
alter table game_private.rate_limits enable row level security;
alter table public.games enable row level security;
alter table public.board_ticks enable row level security;
revoke all on all tables in schema game_private from public, anon, authenticated;
revoke all on public.games, public.board_ticks from anon, authenticated;
grant select on public.games, public.board_ticks to authenticated;

create function game_private.current_player_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from game_private.players where auth_uid = auth.uid();
$$;
create function game_private.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from game_private.players p
    where p.auth_uid = auth.uid()
      and (exists (select 1 from game_private.game_players gp where gp.game_id = gid and gp.player_id = p.id)
           or exists (select 1 from public.games g where g.id = gid and g.host_player_id = p.id)));
$$;
revoke all on function game_private.current_player_id() from public, anon;
revoke all on function game_private.is_member(uuid) from public, anon;
grant execute on function game_private.current_player_id() to authenticated;
grant execute on function game_private.is_member(uuid) to authenticated;

create policy room_members on public.games for select to authenticated using (game_private.is_member(id));
create policy ticks_readable on public.board_ticks for select to authenticated using (true);

alter publication supabase_realtime add table public.games, public.board_ticks;
