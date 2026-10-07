-- Transactional fixtures for ranking, tie-breaks, best-of-three, rooms, grader quota, and season rollover.
-- Run in the Supabase SQL editor (or the MCP execute_sql). Everything rolls back. Raises on the first failure.
begin;
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  pid uuid[] := array[]::uuid[]; r jsonb; sid uuid; gid uuid; season uuid; i int; k int; err text; sub uuid; c jsonb;
begin
  -- Isolate from real data: start a fresh season inside this transaction.
  update game_private.seasons set status = 'archived', ended_at = now() where status = 'active';
  insert into game_private.seasons (name) values ('Fixture season') returning id into season;
  update game_private.app_settings set value = 'true' where key = 'play_open';

  for i in 1..4 loop
    perform set_config('request.jwt.claim.sub', u[i]::text, true);
    r := public.register_player('Fixture ' || i);
    pid := pid || (r->'player'->>'id')::uuid;
  end loop;

  -- A and B both complete all six with total 480; B finishes first, so B ranks above A (tie-break).
  -- C completes with 300. D has only five scenarios (in progress) with a higher total than C.
  for k in 1..6 loop
    insert into game_private.submissions (player_id, season_id, scenario_id, attempt_no, prompt, status, percent, c, o, r, e, graded_at)
    values (pid[1], season, k, 1, 'a', 'graded', 80, 80, 80, 80, 80, now() + interval '2 minutes'),
           (pid[2], season, k, 1, 'b', 'graded', 70, 70, 70, 70, 70, now()),           -- worse first attempt
           (pid[2], season, k, 2, 'b', 'graded', 80, 80, 80, 80, 80, now() + interval '1 minute'), -- best-of counts
           (pid[3], season, k, 1, 'c', 'graded', 50, 50, 50, 50, 50, now());
    if k <= 5 then
      insert into game_private.submissions (player_id, season_id, scenario_id, attempt_no, prompt, status, percent, c, o, r, e, graded_at)
      values (pid[4], season, k, 1, 'd', 'graded', 99, 99, 99, 99, 99, now());
    end if;
  end loop;
  -- Queued submissions never count.
  insert into game_private.submissions (player_id, season_id, scenario_id, attempt_no, prompt, status)
  values (pid[3], season, 1, 2, 'c2', 'queued');

  perform set_config('request.jwt.claim.sub', u[1]::text, true);
  r := public.leaderboard();
  if jsonb_array_length(r->'ranked') <> 3 then raise exception 'expected 3 ranked, got %', r->'ranked'; end if;
  if r->'ranked'->0->>'nickname' <> 'Fixture 2' then raise exception 'tie-break wrong: %', r->'ranked'; end if;
  if (r->'ranked'->0->>'total')::int <> 480 then raise exception 'best-of wrong: %', r->'ranked'->0; end if;
  if r->'ranked'->1->>'nickname' <> 'Fixture 1' or not (r->'ranked'->1->>'is_me')::bool then raise exception 'second wrong'; end if;
  if (r->>'my_rank')::int <> 2 then raise exception 'my_rank wrong'; end if;
  if jsonb_array_length(r->'in_progress') <> 1 or r->'in_progress'->0->>'nickname' <> 'Fixture 4' then raise exception 'in progress wrong: %', r->'in_progress'; end if;
  if r->'in_progress'->0->'scores'->5 <> 'null'::jsonb then raise exception 'missing scenario should be null'; end if;
  if r::text like '%"prompt"%' then raise exception 'leaderboard leaks prompts'; end if;

  -- Rooms: admin hosts, players join, advance, one submission per scenario, room board.
  update game_private.players set is_admin = true where id = pid[1];
  r := public.game_create(120); gid := (r->'game'->>'id')::uuid;
  if r->>'role' <> 'host' then raise exception 'host role'; end if;
  perform set_config('request.jwt.claim.sub', u[2]::text, true);
  begin perform public.game_state(gid); raise exception 'non-member saw room'; exception when others then err := sqlerrm; end;
  if err <> 'Game not found.' then raise exception 'unexpected %', err; end if;
  r := public.game_join(lower(r->'game'->>'code'));
  if r->>'role' <> 'player' then raise exception 'join role'; end if;
  begin perform public.submit_prompt(1, 'too early', gid); raise exception 'lobby submit allowed'; exception when others then err := sqlerrm; end;
  begin perform public.game_advance(gid); raise exception 'player advanced'; exception when others then err := sqlerrm; end;
  if err <> 'Only the host can do that.' then raise exception 'unexpected %', err; end if;
  perform set_config('request.jwt.claim.sub', u[1]::text, true);
  r := public.game_advance(gid);
  if (r->'game'->>'scenario_idx')::int <> 0 or r->'scenario'->>'title' <> 'Exam study site' then raise exception 'advance %', r; end if;
  perform set_config('request.jwt.claim.sub', u[2]::text, true);
  r := public.submit_prompt(1, 'live prompt one two three four five six seven', gid); sub := (r->>'submission_id')::uuid;
  begin perform public.submit_prompt(1, 'again', gid); raise exception 'second live submit allowed'; exception when others then err := sqlerrm; end;
  if err <> 'You already submitted for this scenario.' then raise exception 'unexpected %', err; end if;
  begin perform public.submit_prompt(2, 'wrong scenario', gid); raise exception 'wrong scenario allowed'; exception when others then err := sqlerrm; end;
  r := public.game_state(gid);
  if (r->>'submitted')::int <> 1 or r::text like '%live prompt%' then raise exception 'state %', r; end if;

  -- Grader: claim a slot (mock mode keeps fixture calls off the real ledger), record, room board updates.
  update game_private.app_settings set value = '"mock"' where key = 'grader_mode';
  c := game_private.svc_claim(sub);
  if c->>'model' is null then raise exception 'claim failed %', c; end if;
  if (game_private.svc_claim(sub))->>'reason' <> 'busy' then raise exception 'double claim allowed'; end if;
  perform game_private.svc_record(sub, (c->>'call_id')::uuid,
    '{"c":90,"o":90,"r":90,"e":90,"quality":90,"accuracy":90,"habits":4,"percent":94,"strength":"s","fix":"f","graded_by":"mock"}');
  r := public.leaderboard(null, gid);
  if (r->'ranked'->0->>'total')::int <> 94 then raise exception 'room board %', r; end if;
  if (game_private.svc_claim(sub))->>'reason' <> 'graded' then raise exception 'graded re-claim'; end if;

  -- Quota: with rpm_limit 1 and both mock models used in the last minute, the next claim is refused.
  update game_private.app_settings set value = '1' where key = 'rpm_limit';
  insert into game_private.submissions (player_id, season_id, scenario_id, attempt_no, prompt) values (pid[3], season, 2, 2, 'q1') returning id into sub;
  c := game_private.svc_claim(sub);
  if c->>'model' is null then raise exception 'second model should be free: %', c; end if;
  insert into game_private.submissions (player_id, season_id, scenario_id, attempt_no, prompt) values (pid[3], season, 3, 2, 'q2') returning id into sub;
  if (game_private.svc_claim(sub))->>'reason' <> 'quota' then raise exception 'quota not enforced'; end if;

  -- Season rollover archives the board.
  perform set_config('request.jwt.claim.sub', u[1]::text, true);
  r := public.admin_new_season('Fixture 2');
  r := public.leaderboard();
  if jsonb_array_length(r->'ranked') <> 0 or r->'season'->>'name' <> 'Fixture 2' then raise exception 'rollover %', r; end if;
  r := public.leaderboard(season);
  if jsonb_array_length(r->'ranked') <> 3 or r->'season'->>'status' <> 'archived' then raise exception 'archive %', r; end if;
  raise notice 'scoring.sql: all checks passed';
end $$;
rollback;
