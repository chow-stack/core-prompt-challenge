-- Play RPCs: list_scenarios, submit_prompt, grade_status, my_progress, leaderboard, season_list.

create function game_private.active_season() returns game_private.seasons
language sql stable security definer set search_path = '' as $$
  select * from game_private.seasons where status = 'active';
$$;

create function game_private.list_scenarios() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'position', position, 'title', title,
           'situation', situation, 'goal', goal) order by position), '[]'::jsonb)
  from game_private.scenarios;
$$;

create function game_private.submission_json(s game_private.submissions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'scenario_id', s.scenario_id, 'game_id', s.game_id, 'attempt_no', s.attempt_no, 'is_live', s.is_live,
    'status', s.status, 'prompt', s.prompt,
    'c', s.c, 'o', s.o, 'r', s.r, 'e', s.e, 'quality', s.quality, 'accuracy', s.accuracy, 'habits', s.habits,
    'percent', s.percent, 'strength', s.strength, 'fix', s.fix, 'graded_by', s.graded_by, 'is_estimate', s.is_estimate,
    'created_at', s.created_at, 'graded_at', s.graded_at,
    'queue_position', case when s.status = 'graded' then 0 else (
      select count(*) from game_private.submissions q
       where q.status <> 'graded' and q.queued_at < s.queued_at) end);
$$;

create function game_private.submit_prompt(scenario_id int, prompt text, game_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p game_private.players := game_private.require_player();
  season game_private.seasons := game_private.active_season();
  sc game_private.scenarios; g public.games;
  body text := btrim(coalesce(prompt, ''));
  used int; nextno int; today int; sid uuid;
begin
  if season.id is null then raise exception 'No season is running right now.'; end if;
  select * into sc from game_private.scenarios s where s.id = submit_prompt.scenario_id;
  if sc.id is null then raise exception 'Unknown scenario.'; end if;
  if char_length(body) < 1 then raise exception 'Write a prompt first.'; end if;
  if char_length(body) > 1500 then raise exception 'Prompts can be at most 1500 characters.'; end if;
  perform pg_advisory_xact_lock(hashtext('submit:' || p.id));

  if submit_prompt.game_id is null then
    if not coalesce((game_private.setting('play_open'))::bool, true) then
      raise exception 'Play is closed right now. Check back when the club opens it again.';
    end if;
    select count(*) into used from game_private.submissions s
     where s.player_id = p.id and s.season_id = season.id and s.scenario_id = sc.id and not s.is_live;
    if used >= 3 then raise exception 'You have used all 3 tries on this scenario this season.'; end if;
    select count(*) into today from game_private.submissions s
     where s.player_id = p.id and not s.is_live and s.created_at >= game_private.la_day_start();
    if today >= coalesce((game_private.setting('player_daily_cap'))::int, 18) then
      raise exception 'You have reached today''s grading limit. Come back tomorrow.';
    end if;
  else
    select * into g from public.games x where x.id = submit_prompt.game_id;
    if g.id is null or not exists (select 1 from game_private.game_players gp where gp.game_id = g.id and gp.player_id = p.id) then
      raise exception 'Join the game first.';
    end if;
    if g.phase <> 'playing' or g.scenario_idx <> sc.position then
      raise exception 'That scenario is not open in this game.';
    end if;
    if g.scenario_ends_at is not null and now() > g.scenario_ends_at + interval '10 seconds' then
      raise exception 'Time is up for this scenario.';
    end if;
    if exists (select 1 from game_private.submissions s where s.player_id = p.id and s.game_id = g.id and s.scenario_id = sc.id) then
      raise exception 'You already submitted for this scenario.';
    end if;
  end if;

  select coalesce(max(attempt_no), 0) + 1 into nextno from game_private.submissions s
   where s.player_id = p.id and s.season_id = season.id and s.scenario_id = sc.id;
  insert into game_private.submissions (player_id, season_id, game_id, scenario_id, attempt_no, is_live, prompt)
  values (p.id, coalesce(g.season_id, season.id), g.id, sc.id, nextno, g.id is not null, body)
  returning id into sid;
  if g.id is not null then update public.games set revision = revision + 1 where id = g.id; end if;
  return jsonb_build_object('submission_id', sid, 'status', 'queued');
end $$;

create function game_private.grade_status(submission_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_player(); s game_private.submissions;
begin
  select * into s from game_private.submissions x where x.id = grade_status.submission_id and x.player_id = p.id;
  if s.id is null then raise exception 'Submission not found.'; end if;
  return game_private.submission_json(s);
end $$;

-- Per-scenario best (graded) result, solo attempts left, and in-flight submission for resume.
create function game_private.my_progress(season_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_player(); sid uuid; active bool; today int; cap int;
begin
  sid := coalesce(my_progress.season_id, (game_private.active_season()).id);
  select status = 'active' into active from game_private.seasons where id = sid;
  select count(*) into today from game_private.submissions s
   where s.player_id = p.id and not s.is_live and s.created_at >= game_private.la_day_start();
  cap := coalesce((game_private.setting('player_daily_cap'))::int, 18);
  return jsonb_build_object(
    'season_id', sid,
    'season_active', coalesce(active, false),
    'play_open', coalesce((game_private.setting('play_open'))::bool, true),
    'daily_left', greatest(0, cap - today),
    'scenarios', (
      select jsonb_agg(jsonb_build_object(
        'scenario_id', sc.id, 'position', sc.position,
        'attempts_used', (select count(*) from game_private.submissions s where s.player_id = p.id and s.season_id = sid and s.scenario_id = sc.id and not s.is_live),
        'attempts_left', greatest(0, 3 - (select count(*) from game_private.submissions s where s.player_id = p.id and s.season_id = sid and s.scenario_id = sc.id and not s.is_live)),
        'best', (select game_private.submission_json(s) from game_private.submissions s
                  where s.player_id = p.id and s.season_id = sid and s.scenario_id = sc.id and s.status = 'graded'
                  order by s.percent desc, s.graded_at asc limit 1),
        'latest', (select game_private.submission_json(s) from game_private.submissions s
                  where s.player_id = p.id and s.season_id = sid and s.scenario_id = sc.id and not s.is_live
                  order by s.created_at desc limit 1)
      ) order by sc.position)
      from game_private.scenarios sc),
    'total', (select coalesce(sum(b.percent), 0) from (
      select distinct on (s.scenario_id) s.percent from game_private.submissions s
       where s.player_id = p.id and s.season_id = sid and s.status = 'graded'
       order by s.scenario_id, s.percent desc) b)
  );
end $$;

-- Season board: sum of best percent per scenario (max 600). Ranked = all six scored, ordered by total desc,
-- then earlier completed_at (graded_at of the last of the six best scores). Others go to in_progress.
-- Room board (game_id given): members only; total of the one submission per scenario in that room.
create function game_private.leaderboard(season_id uuid default null, game_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := game_private.current_player_id(); sid uuid; result jsonb; sname text; sstatus text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if leaderboard.game_id is not null then
    if not game_private.is_member(leaderboard.game_id) then raise exception 'Join the game first.'; end if;
    with best as (
      select s.player_id, s.scenario_id, s.percent, s.is_estimate, s.graded_at
        from game_private.submissions s
       where s.game_id = leaderboard.game_id and s.status = 'graded'
    ), rows as (
      select gp.player_id, pl.nickname,
             (select jsonb_agg(b.percent order by sc.position) from game_private.scenarios sc
                left join best b on b.scenario_id = sc.id and b.player_id = gp.player_id) scores,
             (select jsonb_agg(coalesce(b.is_estimate, false) order by sc.position) from game_private.scenarios sc
                left join best b on b.scenario_id = sc.id and b.player_id = gp.player_id) estimates,
             coalesce((select sum(b.percent) from best b where b.player_id = gp.player_id), 0)::int total,
             (select max(b.graded_at) from best b where b.player_id = gp.player_id) last_at,
             coalesce((select bool_or(b.is_estimate) from best b where b.player_id = gp.player_id), false) has_estimate
        from game_private.game_players gp join game_private.players pl on pl.id = gp.player_id
       where gp.game_id = leaderboard.game_id
    )
    select jsonb_build_object('ranked', coalesce(jsonb_agg(jsonb_build_object(
             'rank', rk, 'nickname', nickname, 'scores', scores, 'estimates', estimates, 'total', total,
             'completed', true, 'is_me', player_id = me, 'has_estimate', has_estimate) order by rk), '[]'::jsonb),
           'in_progress', '[]'::jsonb)
      into result
      from (select *, row_number() over (order by total desc, last_at asc nulls last, nickname) rk from rows) x;
    return result;
  end if;

  sid := coalesce(leaderboard.season_id, (game_private.active_season()).id);
  select name, status into sname, sstatus from game_private.seasons where id = sid;
  if sname is null then raise exception 'Season not found.'; end if;
  with best as (
    select distinct on (s.player_id, s.scenario_id) s.player_id, s.scenario_id, s.percent, s.is_estimate, s.graded_at
      from game_private.submissions s
     where s.season_id = sid and s.status = 'graded'
     order by s.player_id, s.scenario_id, s.percent desc, s.graded_at asc
  ), agg as (
    select b.player_id, sum(b.percent)::int total, count(*)::int n, max(b.graded_at) completed_at, bool_or(b.is_estimate) has_estimate
      from best b group by b.player_id
  ), rows as (
    select a.*, pl.nickname, a.n = (select count(*) from game_private.scenarios) completed,
           (select jsonb_agg(b.percent order by sc.position) from game_private.scenarios sc
              left join best b on b.scenario_id = sc.id and b.player_id = a.player_id) scores,
           (select jsonb_agg(coalesce(b.is_estimate, false) order by sc.position) from game_private.scenarios sc
              left join best b on b.scenario_id = sc.id and b.player_id = a.player_id) estimates
      from agg a join game_private.players pl on pl.id = a.player_id
  ), ranked as (
    select *, row_number() over (order by total desc, completed_at asc, nickname) rk from rows where completed
    order by rk limit 200
  ), progress as (
    select * from rows where not completed order by total desc, n desc, nickname limit 200
  )
  select jsonb_build_object(
    'season', jsonb_build_object('id', sid, 'name', sname, 'status', sstatus),
    'ranked', coalesce((select jsonb_agg(jsonb_build_object('rank', rk, 'nickname', nickname, 'scores', scores, 'estimates', estimates,
        'total', total, 'completed', true, 'completed_at', completed_at, 'is_me', player_id = me, 'has_estimate', has_estimate) order by rk) from ranked), '[]'::jsonb),
    'in_progress', coalesce((select jsonb_agg(jsonb_build_object('rank', null, 'nickname', nickname, 'scores', scores, 'estimates', estimates,
        'total', total, 'completed', false, 'is_me', player_id = me, 'has_estimate', has_estimate) order by total desc, n desc, nickname) from progress), '[]'::jsonb),
    'my_rank', (select x.rk from (select player_id, row_number() over (order by total desc, completed_at asc, nickname) rk from rows where completed) x where x.player_id = me)
  ) into result;
  return result;
end $$;

create function game_private.season_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'status', status,
           'started_at', started_at, 'ended_at', ended_at) order by started_at desc), '[]'::jsonb)
  from game_private.seasons;
$$;

revoke all on all functions in schema game_private from public, anon;
grant execute on function game_private.list_scenarios(), game_private.submit_prompt(int, text, uuid),
  game_private.grade_status(uuid), game_private.my_progress(uuid), game_private.leaderboard(uuid, uuid),
  game_private.season_list() to authenticated;
-- Re-grant the earlier ones (the blanket revoke above does not touch role grants, but be explicit).
grant execute on function game_private.current_player_id(), game_private.is_member(uuid) to authenticated;

create function public.list_scenarios() returns jsonb language sql security invoker set search_path = '' as $$ select game_private.list_scenarios(); $$;
create function public.submit_prompt(scenario_id int, prompt text, game_id uuid default null) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.submit_prompt(scenario_id, prompt, game_id); $$;
create function public.grade_status(submission_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.grade_status(submission_id); $$;
create function public.my_progress(season_id uuid default null) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.my_progress(season_id); $$;
create function public.leaderboard(season_id uuid default null, game_id uuid default null) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.leaderboard(season_id, game_id); $$;
create function public.season_list() returns jsonb language sql security invoker set search_path = '' as $$ select game_private.season_list(); $$;
revoke all on function public.list_scenarios(), public.submit_prompt(int, text, uuid), public.grade_status(uuid),
  public.my_progress(uuid), public.leaderboard(uuid, uuid), public.season_list() from public, anon;
grant execute on function public.list_scenarios(), public.submit_prompt(int, text, uuid), public.grade_status(uuid),
  public.my_progress(uuid), public.leaderboard(uuid, uuid), public.season_list() to authenticated;
