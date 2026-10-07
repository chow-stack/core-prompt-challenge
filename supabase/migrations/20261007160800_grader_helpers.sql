-- Worker helpers: is_live in svc_load, and a per-IP limit that counts distinct submissions
-- (the browser re-invokes grade-prompt every few seconds for the same submission; that must not count twice).

create or replace function game_private.svc_load(sub uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'submission', jsonb_build_object('id', s.id, 'status', s.status, 'prompt', s.prompt, 'game_id', s.game_id,
       'is_live', s.is_live, 'tries', s.tries, 'retry_after', s.retry_after, 'regrade_requested', s.regrade_requested,
       'is_estimate', s.is_estimate, 'age_s', extract(epoch from now() - s.queued_at)),
    'owner_auth_uid', p.auth_uid,
    'scenario', jsonb_build_object('title', sc.title, 'situation', sc.situation, 'goal', sc.goal, 'notes', sc.grader_notes, 'must', sc.must),
    'settings', (select jsonb_object_agg(key, value) from game_private.app_settings))
  from game_private.submissions s
  join game_private.players p on p.id = s.player_id
  join game_private.scenarios sc on sc.id = s.scenario_id
  where s.id = sub;
$$;

-- True while this IP has graded at most max_subs distinct submissions in the current hour.
create function game_private.svc_ip_check(ip text, sub uuid, max_subs int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ws timestamptz := date_bin(interval '1 hour', now(), timestamptz '2000-01-01'); n int; fresh bool;
begin
  insert into game_private.rate_limits (key, window_start, count) values ('ipsub:' || ip || ':' || sub, ws, 1)
  on conflict (key, window_start) do nothing;
  get diagnostics n = row_count;
  fresh := n = 1;
  if fresh then
    insert into game_private.rate_limits as rl (key, window_start, count) values ('ip:' || ip, ws, 1)
    on conflict (key, window_start) do update set count = rl.count + 1;
  end if;
  select count into n from game_private.rate_limits where key = 'ip:' || ip and window_start = ws;
  return coalesce(n, 0) <= max_subs;
end $$;

revoke all on function game_private.svc_ip_check(text, uuid, int) from public, anon, authenticated;
grant execute on function game_private.svc_ip_check(text, uuid, int) to service_role;
create function public.svc_ip_check(ip text, sub uuid, max_subs int) returns boolean language sql security invoker set search_path = '' as $$ select game_private.svc_ip_check(ip, sub, max_subs); $$;
revoke all on function public.svc_ip_check(text, uuid, int) from public, anon, authenticated;
grant execute on function public.svc_ip_check(text, uuid, int) to service_role;
