-- Grader internals. Callable only by service_role (Edge Functions). Never granted to anon/authenticated.

-- Everything the worker needs for one submission, including the secret grader notes and must patterns.
create function game_private.svc_load(sub uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'submission', jsonb_build_object('id', s.id, 'status', s.status, 'prompt', s.prompt, 'game_id', s.game_id,
       'tries', s.tries, 'retry_after', s.retry_after, 'regrade_requested', s.regrade_requested, 'is_estimate', s.is_estimate,
       'age_s', extract(epoch from now() - s.queued_at)),
    'owner_auth_uid', p.auth_uid,
    'scenario', jsonb_build_object('title', sc.title, 'situation', sc.situation, 'goal', sc.goal, 'notes', sc.grader_notes, 'must', sc.must),
    'settings', (select jsonb_object_agg(key, value) from game_private.app_settings))
  from game_private.submissions s
  join game_private.players p on p.id = s.player_id
  join game_private.scenarios sc on sc.id = s.scenario_id
  where s.id = sub;
$$;

-- Atomically pick a model with spare per-minute and per-day capacity and record a 'claimed' call.
-- Returns {model, call_id} or {reason: graded|busy|backoff|daily|quota|solo_cap}.
create function game_private.svc_claim(sub uuid, exclude_model text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s game_private.submissions; mode text; pfx text; models jsonb; rpm int; rpd int; solo_cap int;
  m text; best text; best_rpm int; m_rpm int; m_rpd int; any_day_left bool := false; total_today int; cid uuid;
  day0 timestamptz := game_private.la_day_start();
begin
  perform pg_advisory_xact_lock(hashtext('grader-quota'));
  select * into s from game_private.submissions where id = sub for update;
  if s.id is null then return jsonb_build_object('reason', 'missing'); end if;
  if s.status = 'graded' and not s.regrade_requested then return jsonb_build_object('reason', 'graded'); end if;
  if exists (select 1 from game_private.grader_calls c where c.submission_id = sub and c.status = 'claimed'
             and c.created_at > now() - interval '20 seconds') then
    return jsonb_build_object('reason', 'busy');
  end if;
  if s.retry_after is not null and now() < s.retry_after then return jsonb_build_object('reason', 'backoff'); end if;

  mode := coalesce(game_private.setting('grader_mode') #>> '{}', 'gemini');
  pfx := case when mode = 'mock' then 'mock:' else '' end;
  models := coalesce(game_private.setting('models'), '[]'::jsonb);
  rpm := coalesce((game_private.setting('rpm_limit'))::int, 12);
  rpd := coalesce((game_private.setting('rpd_limit'))::int, 450);
  solo_cap := coalesce((game_private.setting('solo_daily_cap'))::int, 550);

  select count(*) into total_today from game_private.grader_calls c
   where c.created_at >= day0 and c.model like pfx || '%' and (pfx <> '' or c.model not like 'mock:%');
  if not s.is_live and total_today >= solo_cap then return jsonb_build_object('reason', 'solo_cap'); end if;

  for m in select jsonb_array_elements_text(models) loop
    continue when m = exclude_model;
    select count(*) filter (where c.created_at > now() - interval '60 seconds'), count(*)
      into m_rpm, m_rpd
      from game_private.grader_calls c where c.model = pfx || m and c.created_at >= least(day0, now() - interval '60 seconds');
    if m_rpd < rpd then any_day_left := true; end if;
    if m_rpm < rpm and m_rpd < rpd and (best is null or m_rpm < best_rpm) then best := m; best_rpm := m_rpm; end if;
  end loop;
  if best is null then
    return jsonb_build_object('reason', case when any_day_left then 'quota' else 'daily' end);
  end if;
  insert into game_private.grader_calls (submission_id, model) values (sub, pfx || best) returning id into cid;
  if s.status <> 'graded' then update game_private.submissions set status = 'grading' where id = sub; end if;
  return jsonb_build_object('model', best, 'call_id', cid, 'mode', mode);
end $$;

-- Write a grade. Idempotent: ignores a submission that is already graded unless a regrade was requested.
create function game_private.svc_record(sub uuid, call_id uuid, grade jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s game_private.submissions; est bool := coalesce((grade->>'is_estimate')::bool, false);
begin
  select * into s from game_private.submissions where id = sub for update;
  if s.id is null then raise exception 'missing submission'; end if;
  if call_id is not null then
    update game_private.grader_calls set status = 'ok', http_status = (grade->>'http_status')::int,
           latency_ms = (grade->>'latency_ms')::int where id = call_id;
  end if;
  if s.status = 'graded' and not s.regrade_requested then return game_private.submission_json(s); end if;
  -- A regrade only replaces an estimate with a real grade; a failed regrade keeps the old estimate.
  if s.status = 'graded' and s.regrade_requested and est then return game_private.submission_json(s); end if;
  update game_private.submissions set
    status = 'graded', regrade_requested = false, retry_after = null,
    c = (grade->>'c')::int, o = (grade->>'o')::int, r = (grade->>'r')::int, e = (grade->>'e')::int,
    quality = (grade->>'quality')::int, accuracy = (grade->>'accuracy')::int, habits = (grade->>'habits')::int,
    percent = (grade->>'percent')::int, strength = left(grade->>'strength', 400), fix = left(grade->>'fix', 400),
    graded_by = grade->>'graded_by', is_estimate = est, graded_at = now()
  where id = sub returning * into s;
  insert into public.board_ticks (scope, updated_at) values ('season:' || s.season_id, now())
    on conflict (scope) do update set updated_at = excluded.updated_at;
  if s.game_id is not null then
    update public.games set revision = revision + 1 where id = s.game_id;
  end if;
  return game_private.submission_json(s);
end $$;

-- Mark a call failed. When `give_up` is true the submission goes back to the queue with backoff 5 s / 15 s / 45 s.
create function game_private.svc_fail(sub uuid, call_id uuid, http_status int, latency_ms int, give_up bool) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if call_id is not null then
    update game_private.grader_calls set status = 'failed', http_status = svc_fail.http_status, latency_ms = svc_fail.latency_ms
     where id = call_id;
  end if;
  if give_up then
    update game_private.submissions set tries = tries + 1,
           status = case when status = 'graded' then status else 'queued' end
     where id = sub returning tries into n;
    update game_private.submissions set retry_after = now() + make_interval(secs => (array[5, 15, 45])[least(n, 3)])
     where id = sub;
  end if;
end $$;

-- Oldest queued (or stuck grading) submissions plus pending regrades, for the drain worker.
create function game_private.svc_next_queued(lim int) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(id), '[]'::jsonb) from (
    select id from game_private.submissions
     where (status <> 'graded' or regrade_requested) and (retry_after is null or retry_after <= now())
     order by (status = 'graded'), queued_at limit greatest(1, least(lim, 50))) x;
$$;

-- Shared secret for the drain-queue cron call, kept in Vault (no function secret needed).
create function game_private.svc_check_drain_token(token text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'drain_token' and decrypted_secret = token);
$$;

revoke all on all functions in schema game_private from public, anon;

-- service_role-only public entry points for the Edge Functions (PostgREST only exposes public).
create function public.svc_load(sub uuid) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.svc_load(sub); $$;
create function public.svc_claim(sub uuid, exclude_model text default null) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.svc_claim(sub, exclude_model); $$;
create function public.svc_record(sub uuid, call_id uuid, grade jsonb) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.svc_record(sub, call_id, grade); $$;
create function public.svc_fail(sub uuid, call_id uuid, http_status int, latency_ms int, give_up bool) returns void language sql security invoker set search_path = '' as $$ select game_private.svc_fail(sub, call_id, http_status, latency_ms, give_up); $$;
create function public.svc_next_queued(lim int) returns jsonb language sql security invoker set search_path = '' as $$ select game_private.svc_next_queued(lim); $$;
create function public.svc_check_drain_token(token text) returns boolean language sql security invoker set search_path = '' as $$ select game_private.svc_check_drain_token(token); $$;

revoke all on function public.svc_load(uuid), public.svc_claim(uuid, text), public.svc_record(uuid, uuid, jsonb),
  public.svc_fail(uuid, uuid, int, int, bool), public.svc_next_queued(int), public.svc_check_drain_token(text)
  from public, anon, authenticated;
grant usage on schema game_private to service_role;
grant execute on function game_private.svc_load(uuid), game_private.svc_claim(uuid, text), game_private.svc_record(uuid, uuid, jsonb),
  game_private.svc_fail(uuid, uuid, int, int, bool), game_private.svc_next_queued(int), game_private.svc_check_drain_token(text)
  to service_role;
grant execute on function public.svc_load(uuid), public.svc_claim(uuid, text), public.svc_record(uuid, uuid, jsonb),
  public.svc_fail(uuid, uuid, int, int, bool), public.svc_next_queued(int), public.svc_check_drain_token(text)
  to service_role;
