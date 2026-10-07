-- Test/ops helper: change a grader setting with the service-role (secret) key. Never exposed to players.
-- Used by tests/integration.mjs and tests/load.mjs (SUPABASE_SECRET_KEY in .env.local). From the SQL editor, just
-- update game_private.app_settings directly.
create function game_private.svc_set_setting(key text, value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if key not in ('grader_mode', 'play_open', 'rpm_limit', 'rpd_limit', 'solo_daily_cap', 'player_daily_cap', 'queue_timeout_s', 'models') then
    raise exception 'Unknown setting.';
  end if;
  if key = 'grader_mode' and value #>> '{}' not in ('gemini', 'estimate', 'mock') then raise exception 'Bad mode.'; end if;
  update game_private.app_settings s set value = svc_set_setting.value where s.key = svc_set_setting.key;
end $$;
revoke all on function game_private.svc_set_setting(text, jsonb) from public, anon, authenticated;
grant execute on function game_private.svc_set_setting(text, jsonb) to service_role;
create function public.svc_set_setting(key text, value jsonb) returns void language sql security invoker set search_path = '' as $$ select game_private.svc_set_setting(key, value); $$;
revoke all on function public.svc_set_setting(text, jsonb) from public, anon, authenticated;
grant execute on function public.svc_set_setting(text, jsonb) to service_role;

-- Players may now delete their own player (used by tests to clean up; also lets a member wipe their scores).
create function game_private.delete_me() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  delete from game_private.players where auth_uid = auth.uid();
end $$;
revoke all on function game_private.delete_me() from public, anon;
grant execute on function game_private.delete_me() to authenticated;
create function public.delete_me() returns void language sql security invoker set search_path = '' as $$ select game_private.delete_me(); $$;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;
