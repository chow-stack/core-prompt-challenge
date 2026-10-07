-- Live rooms: game_create, game_join, game_state, game_advance, game_end.
-- Hosts are admins and spectate; players are registered players who joined with the code.

create function game_private.game_state(game_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := game_private.current_player_id(); g public.games; sc game_private.scenarios; role text; host text;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into g from public.games x where x.id = game_state.game_id;
  if g.id is null or not game_private.is_member(g.id) then raise exception 'Game not found.'; end if;
  role := case when g.host_player_id = me then 'host' else 'player' end;
  select nickname into host from game_private.players where id = g.host_player_id;
  if g.phase = 'playing' then select * into sc from game_private.scenarios where position = g.scenario_idx; end if;
  return jsonb_build_object(
    'game', jsonb_build_object('id', g.id, 'code', g.code, 'phase', g.phase, 'scenario_idx', g.scenario_idx,
      'scenario_ends_at', g.scenario_ends_at, 'timer_seconds', g.timer_seconds, 'revision', g.revision,
      'expires_at', g.expires_at, 'host_nickname', host, 'season_id', g.season_id),
    'role', role,
    'me', me,
    'scenario', case when sc.id is null then null else jsonb_build_object('id', sc.id, 'position', sc.position,
      'title', sc.title, 'situation', sc.situation, 'goal', sc.goal) end,
    'player_count', (select count(*) from game_private.game_players gp where gp.game_id = g.id),
    'submitted', case when sc.id is null then 0 else (select count(*) from game_private.submissions s
      where s.game_id = g.id and s.scenario_id = sc.id) end,
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', pl.id, 'nickname', pl.nickname, 'is_me', pl.id = me) order by gp.joined_at)
      from game_private.game_players gp join game_private.players pl on pl.id = gp.player_id where gp.game_id = g.id), '[]'::jsonb),
    'my_submissions', coalesce((select jsonb_agg(jsonb_build_object('scenario_id', s.scenario_id, 'submission_id', s.id,
      'status', s.status, 'percent', s.percent))
      from game_private.submissions s where s.game_id = g.id and s.player_id = me), '[]'::jsonb),
    'server_time', now()
  );
end $$;

create function game_private.game_create(timer_seconds int default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_admin(); season game_private.seasons := game_private.active_season();
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ'; c text; i int; gid uuid; t int := greatest(30, least(1800, coalesce(timer_seconds, 300)));
begin
  if season.id is null then raise exception 'Start a season before hosting.'; end if;
  delete from public.games where expires_at < now() - interval '1 day';
  if (select count(*) from public.games where host_player_id = p.id and phase <> 'finished' and expires_at > now()) >= 3 then
    raise exception 'You already have 3 open rooms. End one first.';
  end if;
  for attempt in 1..20 loop
    c := '';
    for i in 1..4 loop c := c || substr(a, 1 + floor(random() * 24)::int, 1); end loop;
    begin
      insert into public.games (code, host_player_id, season_id, timer_seconds) values (c, p.id, season.id, t) returning id into gid;
      exit;
    exception when unique_violation then
      -- Reuse codes of expired rooms.
      delete from public.games where code = c and expires_at < now();
    end;
  end loop;
  if gid is null then raise exception 'Could not find a free code. Try again.'; end if;
  return game_private.game_state(gid);
end $$;

create function game_private.game_join(code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_player(); g public.games; k text := upper(btrim(coalesce(code, '')));
begin
  perform game_private.rate_hit('join:' || p.id, interval '1 hour', 30, 'Too many join attempts. Try again later.');
  if k !~ '^[A-Z]{4}$' then raise exception 'Enter the 4-letter code shown on the host screen.'; end if;
  select * into g from public.games x where x.code = k and x.expires_at > now();
  if g.id is null then raise exception 'No game with that code. Check the code with your host.'; end if;
  if g.host_player_id = p.id then return game_private.game_state(g.id); end if;
  if exists (select 1 from game_private.game_players where game_id = g.id and player_id = p.id) then
    return game_private.game_state(g.id);
  end if;
  if g.phase = 'finished' then raise exception 'That game has ended.'; end if;
  perform 1 from public.games where id = g.id for update;
  if (select count(*) from game_private.game_players where game_id = g.id) >= 60 then raise exception 'That game is full.'; end if;
  insert into game_private.game_players (game_id, player_id) values (g.id, p.id);
  update public.games set revision = revision + 1 where id = g.id;
  return game_private.game_state(g.id);
end $$;

create function game_private.require_host(gid uuid) returns public.games
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_player(); g public.games;
begin
  select * into g from public.games where id = gid for update;
  if g.id is null or g.host_player_id <> p.id then raise exception 'Only the host can do that.'; end if;
  return g;
end $$;

create function game_private.game_advance(game_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.games := game_private.require_host(game_id); n int := (select count(*) from game_private.scenarios);
begin
  if g.phase = 'finished' then raise exception 'This game has finished.'; end if;
  if g.scenario_idx + 1 >= n then
    update public.games set phase = 'finished', scenario_idx = n, scenario_ends_at = null, revision = revision + 1,
           expires_at = greatest(expires_at, now() + interval '2 hours') where id = g.id;
  else
    update public.games set phase = 'playing', scenario_idx = g.scenario_idx + 1,
           scenario_ends_at = now() + make_interval(secs => g.timer_seconds), revision = revision + 1,
           expires_at = greatest(expires_at, now() + interval '2 hours') where id = g.id;
  end if;
  return game_private.game_state(g.id);
end $$;

create function game_private.game_end(game_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.games := game_private.require_host(game_id);
begin
  update public.games set phase = 'finished', scenario_ends_at = null, revision = revision + 1 where id = g.id;
  return game_private.game_state(g.id);
end $$;

revoke all on all functions in schema game_private from public, anon;
grant execute on function game_private.game_state(uuid), game_private.game_create(int), game_private.game_join(text),
  game_private.game_advance(uuid), game_private.game_end(uuid) to authenticated;

create function public.game_state(game_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.game_state(game_id); $$;
create function public.game_create(timer_seconds int default 300) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.game_create(timer_seconds); $$;
create function public.game_join(code text) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.game_join(code); $$;
create function public.game_advance(game_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.game_advance(game_id); $$;
create function public.game_end(game_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.game_end(game_id); $$;
revoke all on function public.game_state(uuid), public.game_create(int), public.game_join(text),
  public.game_advance(uuid), public.game_end(uuid) from public, anon;
grant execute on function public.game_state(uuid), public.game_create(int), public.game_join(text),
  public.game_advance(uuid), public.game_end(uuid) to authenticated;
