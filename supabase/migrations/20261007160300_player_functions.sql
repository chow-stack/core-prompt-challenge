-- Helpers plus identity RPCs: me, register_player, rename_player, recover_player, rotate_recovery_code.
-- Pattern: logic in game_private.* (security definer, empty search_path); thin public.* security invoker wrappers.

create function game_private.setting(k text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select value from game_private.app_settings where key = k;
$$;

-- Start of the current America/Los_Angeles day (Gemini RPD resets at midnight Pacific).
create function game_private.la_day_start() returns timestamptz
language sql stable set search_path = '' as $$
  select (date_trunc('day', now() at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles';
$$;

-- Fixed-window counter. Raises msg when the window already has max hits.
create function game_private.rate_hit(k text, win interval, max_hits int, msg text) returns void
language plpgsql security definer set search_path = '' as $$
declare ws timestamptz := date_bin(win, now(), timestamptz '2000-01-01'); n int;
begin
  insert into game_private.rate_limits as rl (key, window_start, count) values (k, ws, 1)
  on conflict (key, window_start) do update set count = rl.count + 1
  returning count into n;
  if n > max_hits then raise exception '%', msg; end if;
  -- Opportunistic cleanup of old windows.
  if random() < 0.02 then delete from game_private.rate_limits where window_start < now() - interval '2 days'; end if;
end $$;

create function game_private.clean_nickname(raw text) returns text
language plpgsql security definer set search_path = '' as $$
declare n text; squashed text;
begin
  n := btrim(regexp_replace(coalesce(raw, ''), '[\x01-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]', '', 'g'));
  n := regexp_replace(n, '\s+', ' ', 'g');
  if char_length(n) < 1 then raise exception 'Enter a nickname.'; end if;
  if char_length(n) > 20 then raise exception 'Nicknames can be at most 20 characters.'; end if;
  squashed := regexp_replace(lower(n), '[^a-z]', '', 'g');
  if exists (select 1 from game_private.banned_words b
             where (not b.whole_word and strpos(squashed, b.word) > 0)
                or (b.whole_word and lower(n) ~ ('\m' || b.word || 's?\M'))) then
    raise exception 'Please pick a different nickname.';
  end if;
  return n;
end $$;

-- XXXX-XXXX from an unambiguous alphabet (no 0/O, 1/I/L).
create function game_private.new_recovery_code() returns text
language plpgsql security definer set search_path = '' as $$
declare a text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(8); s text := ''; i int;
begin
  for i in 0..7 loop s := s || substr(a, 1 + (get_byte(b, i) % char_length(a)), 1); end loop;
  return substr(s, 1, 4) || '-' || substr(s, 5, 4);
end $$;

create function game_private.norm_recovery_code(raw text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(upper(coalesce(raw, '')), '[^A-Z0-9]', '', 'g');
$$;

create function game_private.player_json(p game_private.players) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'nickname', p.nickname, 'is_admin', p.is_admin);
$$;

create function game_private.require_player() returns game_private.players
language plpgsql security definer set search_path = '' as $$
declare p game_private.players;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into p from game_private.players where auth_uid = auth.uid();
  if p.id is null then raise exception 'Pick a nickname first.'; end if;
  return p;
end $$;

create function game_private.require_admin() returns game_private.players
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_player();
begin
  if not p.is_admin then raise exception 'Only club leaders can do that.'; end if;
  return p;
end $$;

create function game_private.me() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p game_private.players;
begin
  if auth.uid() is null then return null; end if;
  update game_private.players set last_seen_at = now()
   where auth_uid = auth.uid() and last_seen_at < now() - interval '5 minutes';
  select * into p from game_private.players where auth_uid = auth.uid();
  if p.id is null then return null; end if;
  return game_private.player_json(p);
end $$;

create function game_private.register_player(nickname text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n text; code text; p game_private.players;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from game_private.players where auth_uid = auth.uid()) then
    raise exception 'This device already has a player.';
  end if;
  perform game_private.rate_hit('register:' || auth.uid(), interval '1 hour', 10, 'Too many attempts. Try again later.');
  n := game_private.clean_nickname(nickname);
  if exists (select 1 from game_private.players where nickname_key = lower(btrim(n))) then
    raise exception 'That nickname is taken. Try another, or recover your player if it is yours.';
  end if;
  code := game_private.new_recovery_code();
  insert into game_private.players (auth_uid, nickname, recovery_hash)
  values (auth.uid(), n, extensions.crypt(game_private.norm_recovery_code(code), extensions.gen_salt('bf', 8)))
  returning * into p;
  return jsonb_build_object('player', game_private.player_json(p), 'recovery_code', code);
exception when unique_violation then
  raise exception 'That nickname is taken. Try another, or recover your player if it is yours.';
end $$;

create function game_private.rename_player(nickname text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_player(); n text;
begin
  n := game_private.clean_nickname(nickname);
  if lower(btrim(n)) <> p.nickname_key and exists (select 1 from game_private.players where nickname_key = lower(btrim(n))) then
    raise exception 'That nickname is taken.';
  end if;
  perform game_private.rate_hit('rename:' || p.id, interval '1 day', 3, 'You can rename at most 3 times a day.');
  update game_private.players set nickname = n where id = p.id returning * into p;
  update public.games g set revision = revision + 1
   where g.phase <> 'finished' and g.expires_at > now()
     and exists (select 1 from game_private.game_players gp where gp.game_id = g.id and gp.player_id = p.id);
  return game_private.player_json(p);
exception when unique_violation then
  raise exception 'That nickname is taken.';
end $$;

create function game_private.recover_player(nickname text, code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare target game_private.players; mine game_private.players; k text := lower(btrim(coalesce(nickname, '')));
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  perform game_private.rate_hit('recover:uid:' || auth.uid(), interval '1 hour', 5, 'Too many recovery attempts. Try again in an hour.');
  perform game_private.rate_hit('recover:nick:' || k, interval '1 hour', 5, 'Too many recovery attempts for that nickname. Try again in an hour.');
  select * into target from game_private.players where nickname_key = k;
  if target.id is null or target.recovery_hash is null
     or extensions.crypt(game_private.norm_recovery_code(code), target.recovery_hash) <> target.recovery_hash then
    raise exception 'That nickname and recovery code do not match.';
  end if;
  if target.auth_uid = auth.uid() then return game_private.player_json(target); end if;
  select * into mine from game_private.players where auth_uid = auth.uid();
  if mine.id is not null then
    if exists (select 1 from game_private.submissions where player_id = mine.id) then
      raise exception 'This device already plays as %. Use a different browser to recover another player.', mine.nickname;
    end if;
    delete from game_private.players where id = mine.id;
  end if;
  update game_private.players set auth_uid = auth.uid(), last_seen_at = now() where id = target.id returning * into target;
  return game_private.player_json(target);
end $$;

create function game_private.rotate_recovery_code() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_player(); code text := game_private.new_recovery_code();
begin
  perform game_private.rate_hit('rotate:' || p.id, interval '1 hour', 5, 'Too many new codes. Try again later.');
  update game_private.players
     set recovery_hash = extensions.crypt(game_private.norm_recovery_code(code), extensions.gen_salt('bf', 8))
   where id = p.id;
  return jsonb_build_object('recovery_code', code);
end $$;

-- Grants for private functions (only what the public wrappers need).
revoke all on all functions in schema game_private from public, anon;
grant execute on function game_private.me(), game_private.register_player(text), game_private.rename_player(text),
  game_private.recover_player(text, text), game_private.rotate_recovery_code() to authenticated;

create function public.me() returns jsonb language sql security invoker set search_path = '' as $$ select game_private.me(); $$;
create function public.register_player(nickname text) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.register_player(nickname); $$;
create function public.rename_player(nickname text) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.rename_player(nickname); $$;
create function public.recover_player(nickname text, code text) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.recover_player(nickname, code); $$;
create function public.rotate_recovery_code() returns jsonb language sql security invoker set search_path = '' as $$ select game_private.rotate_recovery_code(); $$;
revoke all on function public.me(), public.register_player(text), public.rename_player(text),
  public.recover_player(text, text), public.rotate_recovery_code() from public, anon;
grant execute on function public.me(), public.register_player(text), public.rename_player(text),
  public.recover_player(text, text), public.rotate_recovery_code() to authenticated;
