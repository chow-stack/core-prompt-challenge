-- Admin: claim_admin (bcrypt-hashed passphrase in the DB, rate-limited) and club-leader controls.
-- Set or change the passphrase from the SQL editor:  select game_private.set_admin_passphrase('...');

create table game_private.secrets (key text primary key, value text not null);
alter table game_private.secrets enable row level security;
revoke all on game_private.secrets from public, anon, authenticated;

create function game_private.set_admin_passphrase(passphrase text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(coalesce(passphrase, '')) < 12 then raise exception 'Use at least 12 characters.'; end if;
  insert into game_private.secrets (key, value) values ('admin_passphrase', extensions.crypt(passphrase, extensions.gen_salt('bf', 10)))
  on conflict (key) do update set value = excluded.value;
end $$;

create function game_private.claim_admin(passphrase text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_player(); h text;
begin
  perform game_private.rate_hit('admin:' || auth.uid(), interval '1 hour', 5, 'Too many attempts. Try again in an hour.');
  select value into h from game_private.secrets where key = 'admin_passphrase';
  if h is null then raise exception 'Admin access is not set up yet.'; end if;
  if extensions.crypt(coalesce(passphrase, ''), h) <> h then raise exception 'That passphrase is not right.'; end if;
  update game_private.players set is_admin = true where id = p.id returning * into p;
  return game_private.player_json(p);
end $$;

create function game_private.admin_set_setting(key text, value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a game_private.players := game_private.require_admin(); n numeric;
begin
  if key = 'grader_mode' then
    if value #>> '{}' not in ('gemini', 'estimate', 'mock') then raise exception 'Mode must be gemini, estimate, or mock.'; end if;
  elsif key = 'play_open' then
    if jsonb_typeof(value) <> 'boolean' then raise exception 'play_open must be true or false.'; end if;
  elsif key in ('rpm_limit', 'rpd_limit', 'solo_daily_cap', 'player_daily_cap', 'queue_timeout_s') then
    if jsonb_typeof(value) <> 'number' then raise exception '% must be a number.', key; end if;
    n := (value #>> '{}')::numeric;
    if n < 1 or n > 5000 or n <> trunc(n) then raise exception '% must be a whole number from 1 to 5000.', key; end if;
  elsif key = 'models' then
    if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) not between 1 and 4
       or exists (select 1 from jsonb_array_elements(value) v where jsonb_typeof(v) <> 'string' or v #>> '{}' !~ '^gemini-[a-z0-9.-]{1,40}$') then
      raise exception 'models must be 1 to 4 Gemini model names.';
    end if;
  else
    raise exception 'Unknown setting.';
  end if;
  insert into game_private.app_settings as s (key, value) values (admin_set_setting.key, admin_set_setting.value)
  on conflict on constraint app_settings_pkey do update set value = excluded.value;
  return game_private.admin_stats();
end $$;

create function game_private.admin_new_season(name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a game_private.players := game_private.require_admin(); n text := btrim(coalesce(name, ''));
begin
  if char_length(n) not between 1 and 40 then raise exception 'Season names are 1 to 40 characters.'; end if;
  update game_private.seasons set status = 'archived', ended_at = now() where status = 'active';
  insert into game_private.seasons (name) values (n);
  return game_private.admin_stats();
end $$;

create function game_private.admin_regrade_estimates() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a game_private.players := game_private.require_admin(); n int;
begin
  update game_private.submissions set regrade_requested = true, retry_after = null, tries = 0, queued_at = now()
   where status = 'graded' and is_estimate and not regrade_requested
     and season_id = (game_private.active_season()).id;
  get diagnostics n = row_count;
  return game_private.admin_stats() || jsonb_build_object('requeued', n);
end $$;

create function game_private.admin_remove_player(player_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a game_private.players := game_private.require_admin();
begin
  if player_id = a.id then raise exception 'You cannot remove yourself.'; end if;
  update public.games g set revision = revision + 1
   where exists (select 1 from game_private.game_players gp where gp.game_id = g.id and gp.player_id = admin_remove_player.player_id);
  delete from game_private.players p where p.id = admin_remove_player.player_id;
  insert into public.board_ticks (scope, updated_at) values ('season:' || (game_private.active_season()).id, now())
    on conflict (scope) do update set updated_at = excluded.updated_at;
  return game_private.admin_stats();
end $$;

create function game_private.admin_players(search text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a game_private.players := game_private.require_admin();
begin
  return coalesce((select jsonb_agg(x order by x->>'nickname') from (
    select jsonb_build_object('id', p.id, 'nickname', p.nickname, 'is_admin', p.is_admin, 'created_at', p.created_at,
             'submissions', (select count(*) from game_private.submissions s where s.player_id = p.id)) x
      from game_private.players p
     where p.nickname_key like '%' || lower(btrim(coalesce(search, ''))) || '%'
     order by p.nickname_key limit 100) y), '[]'::jsonb);
end $$;

create function game_private.admin_end_room(game_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a game_private.players := game_private.require_admin();
begin
  update public.games g set phase = 'finished', scenario_ends_at = null, revision = revision + 1 where g.id = admin_end_room.game_id;
  return game_private.admin_stats();
end $$;

create function game_private.admin_stats() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a game_private.players := game_private.require_admin(); day0 timestamptz := game_private.la_day_start(); season game_private.seasons := game_private.active_season();
begin
  return jsonb_build_object(
    'settings', (select jsonb_object_agg(key, value) from game_private.app_settings),
    'season', case when season.id is null then null else jsonb_build_object('id', season.id, 'name', season.name, 'started_at', season.started_at) end,
    'calls', coalesce((select jsonb_agg(jsonb_build_object('model', model, 'today', today, 'last_minute', last_minute, 'failed_today', failed) order by model)
      from (select c.model, count(*) today, count(*) filter (where c.created_at > now() - interval '60 seconds') last_minute,
                   count(*) filter (where c.status = 'failed') failed
              from game_private.grader_calls c where c.created_at >= day0 group by c.model) m), '[]'::jsonb),
    'queue_length', (select count(*) from game_private.submissions where status <> 'graded'),
    'regrade_pending', (select count(*) from game_private.submissions where regrade_requested),
    'estimates', (select count(*) from game_private.submissions where is_estimate and season_id = season.id),
    'graded_today', (select count(*) from game_private.submissions where graded_at >= day0),
    'players', (select count(*) from game_private.players),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'phase', g.phase, 'scenario_idx', g.scenario_idx,
        'host', (select nickname from game_private.players where id = g.host_player_id),
        'players', (select count(*) from game_private.game_players gp where gp.game_id = g.id), 'created_at', g.created_at) order by g.created_at desc)
      from public.games g where g.expires_at > now() and g.phase <> 'finished'), '[]'::jsonb),
    'server_time', now()
  );
end $$;

revoke all on all functions in schema game_private from public, anon;
grant execute on function game_private.claim_admin(text), game_private.admin_set_setting(text, jsonb), game_private.admin_new_season(text),
  game_private.admin_regrade_estimates(), game_private.admin_remove_player(uuid), game_private.admin_players(text),
  game_private.admin_end_room(uuid), game_private.admin_stats() to authenticated;

create function public.claim_admin(passphrase text) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.claim_admin(passphrase); $$;
create function public.admin_set_setting(key text, value jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.admin_set_setting(key, value); $$;
create function public.admin_set_mode(mode text) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.admin_set_setting('grader_mode', to_jsonb(mode)); $$;
create function public.admin_set_play_open(open bool) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.admin_set_setting('play_open', to_jsonb(open)); $$;
create function public.admin_new_season(name text) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.admin_new_season(name); $$;
create function public.admin_regrade_estimates() returns jsonb language sql security invoker set search_path = '' as $$ select game_private.admin_regrade_estimates(); $$;
create function public.admin_remove_player(player_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.admin_remove_player(player_id); $$;
create function public.admin_players(search text default '') returns jsonb language sql security invoker set search_path = '' as $$ select game_private.admin_players(search); $$;
create function public.admin_end_room(game_id uuid) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.admin_end_room(game_id); $$;
create function public.admin_stats() returns jsonb language sql security invoker set search_path = '' as $$ select game_private.admin_stats(); $$;
revoke all on function public.claim_admin(text), public.admin_set_setting(text, jsonb), public.admin_set_mode(text), public.admin_set_play_open(bool),
  public.admin_new_season(text), public.admin_regrade_estimates(), public.admin_remove_player(uuid), public.admin_players(text),
  public.admin_end_room(uuid), public.admin_stats() from public, anon;
grant execute on function public.claim_admin(text), public.admin_set_setting(text, jsonb), public.admin_set_mode(text), public.admin_set_play_open(bool),
  public.admin_new_season(text), public.admin_regrade_estimates(), public.admin_remove_player(uuid), public.admin_players(text),
  public.admin_end_room(uuid), public.admin_stats() to authenticated;
