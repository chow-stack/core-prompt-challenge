-- 2026-10-07 changes requested by Caio:
--  * One graded attempt per scenario (solo), not three.
--  * Recovery codes removed.
--  * Admin role and passphrase removed: the game is played inside club meetings, so any player can host a room.
--    Grader settings stay in game_private.app_settings and are edited from the SQL editor.
--  * Scenarios 4-6 replaced with fun, non-school scenarios (1-3 unchanged).

-- ---------- Admin removal ----------
drop function if exists public.claim_admin(text), public.admin_set_setting(text, jsonb), public.admin_set_mode(text),
  public.admin_set_play_open(bool), public.admin_new_season(text), public.admin_regrade_estimates(),
  public.admin_remove_player(uuid), public.admin_players(text), public.admin_end_room(uuid), public.admin_stats();
drop function if exists game_private.claim_admin(text), game_private.admin_set_setting(text, jsonb),
  game_private.admin_new_season(text), game_private.admin_regrade_estimates(), game_private.admin_remove_player(uuid),
  game_private.admin_players(text), game_private.admin_end_room(uuid), game_private.admin_stats(),
  game_private.set_admin_passphrase(text);
drop table if exists game_private.secrets;

-- ---------- Recovery code removal ----------
drop function if exists public.recover_player(text, text), public.rotate_recovery_code();
drop function if exists game_private.recover_player(text, text), game_private.rotate_recovery_code(),
  game_private.new_recovery_code(), game_private.norm_recovery_code(text);

create or replace function game_private.player_json(p game_private.players) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'nickname', p.nickname);
$$;

create or replace function game_private.register_player(nickname text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n text; p game_private.players;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from game_private.players where auth_uid = auth.uid()) then
    raise exception 'This device already has a player.';
  end if;
  perform game_private.rate_hit('register:' || auth.uid(), interval '1 hour', 10, 'Too many attempts. Try again later.');
  n := game_private.clean_nickname(nickname);
  if exists (select 1 from game_private.players where nickname_key = lower(btrim(n))) then
    raise exception 'That nickname is taken. Try another.';
  end if;
  insert into game_private.players (auth_uid, nickname) values (auth.uid(), n) returning * into p;
  return jsonb_build_object('player', game_private.player_json(p));
exception when unique_violation then
  raise exception 'That nickname is taken. Try another.';
end $$;

drop function if exists game_private.require_admin();
alter table game_private.players drop column if exists recovery_hash, drop column if exists is_admin;

-- ---------- Any registered player can host ----------
create or replace function game_private.game_create(timer_seconds int default 300) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_player(); season game_private.seasons := game_private.active_season();
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ'; c text; i int; gid uuid; t int := greatest(30, least(1800, coalesce(timer_seconds, 300)));
begin
  if season.id is null then raise exception 'No season is running right now.'; end if;
  perform game_private.rate_hit('create:' || p.id, interval '1 hour', 10, 'Too many new games. Try again later.');
  delete from public.games where expires_at < now() - interval '1 day';
  -- One open room per host: opening a new one ends the previous.
  update public.games set phase = 'finished', scenario_ends_at = null, revision = revision + 1
   where host_player_id = p.id and phase <> 'finished';
  for attempt in 1..20 loop
    c := '';
    for i in 1..4 loop c := c || substr(a, 1 + floor(random() * 24)::int, 1); end loop;
    begin
      insert into public.games (code, host_player_id, season_id, timer_seconds) values (c, p.id, season.id, t) returning id into gid;
      exit;
    exception when unique_violation then
      delete from public.games where code = c and expires_at < now();
    end;
  end loop;
  if gid is null then raise exception 'Could not find a free code. Try again.'; end if;
  return game_private.game_state(gid);
end $$;

-- The host's own open room (to resume after a refresh).
create function game_private.my_hosted_game() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', g.id, 'code', g.code, 'phase', g.phase)
    from public.games g
   where g.host_player_id = game_private.current_player_id() and g.phase <> 'finished' and g.expires_at > now()
   order by g.created_at desc limit 1;
$$;

-- ---------- One try per scenario (solo) ----------
create or replace function game_private.submit_prompt(scenario_id int, prompt text, game_id uuid default null) returns jsonb
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
    if used >= 1 then raise exception 'You already submitted a prompt for this scenario.'; end if;
    select count(*) into today from game_private.submissions s
     where s.player_id = p.id and not s.is_live and s.created_at >= game_private.la_day_start();
    if today >= coalesce((game_private.setting('player_daily_cap'))::int, 6) then
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

create or replace function game_private.my_progress(season_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p game_private.players := game_private.require_player(); sid uuid; active bool; today int; cap int;
begin
  sid := coalesce(my_progress.season_id, (game_private.active_season()).id);
  select status = 'active' into active from game_private.seasons where id = sid;
  select count(*) into today from game_private.submissions s
   where s.player_id = p.id and not s.is_live and s.created_at >= game_private.la_day_start();
  cap := coalesce((game_private.setting('player_daily_cap'))::int, 6);
  return jsonb_build_object(
    'season_id', sid,
    'season_active', coalesce(active, false),
    'play_open', coalesce((game_private.setting('play_open'))::bool, true),
    'daily_left', greatest(0, cap - today),
    'scenarios', (
      select jsonb_agg(jsonb_build_object(
        'scenario_id', sc.id, 'position', sc.position,
        'attempts_used', (select count(*) from game_private.submissions s where s.player_id = p.id and s.season_id = sid and s.scenario_id = sc.id and not s.is_live),
        'attempts_left', greatest(0, 1 - (select count(*) from game_private.submissions s where s.player_id = p.id and s.season_id = sid and s.scenario_id = sc.id and not s.is_live)),
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

update game_private.app_settings set value = '6' where key = 'player_daily_cap';

revoke all on all functions in schema game_private from public, anon;
grant execute on function game_private.my_hosted_game() to authenticated;
create function public.my_hosted_game() returns jsonb language sql security invoker set search_path = '' as $$ select game_private.my_hosted_game(); $$;
revoke all on function public.my_hosted_game() from public, anon;
grant execute on function public.my_hosted_game() to authenticated;

-- ---------- Scenarios 4-6 ----------
-- Generated by scripts/gen-seed.mjs --scenarios-only from shared/scenarios.ts.
insert into game_private.scenarios (id, position, title, situation, goal, grader_notes, must) values
  (1, 0, 'Exam study site', 'Your Econ 201 midterm is Thursday and you are weakest on supply and demand. You have your lecture slides, handwritten notes, and a practice exam ready to attach.', 'Get the AI to build an interactive study site made only from your own materials, with flashcards and a timed practice test.', 'Strong prompt: gives a role such as tutor, the exam date and weak spot, and attaches slides, notes and practice exam; asks for an interactive site with a set number of flashcards and a timed practice test with a set number of questions; says to use only the attached materials; asks it to match the practice exam style and a design reference like Quizlet; ends with an invitation to ask questions first.', '["\\b(site|website|app|interactive)\\b","flashcard","\\b(practice )?(test|exam|quiz)","\\bonly\\b|\\battach|my (slides|notes|materials)","supply|demand|weak|econ","\\d"]'::jsonb),
  (2, 1, 'Mock interview', 'You have a first-round marketing internship interview next week. You have the job posting in front of you and want to practice out loud.', 'Get the AI to act as a tough recruiter, ask behavioral questions one at a time, and grade each answer with the STAR method.', 'Strong prompt: sets the recruiter role and company, includes the job posting, asks for a set number of behavioral questions one at a time, says to grade each answer with STAR, sets a tough tone, adds rules such as wait for my answer before the next question, and may ask for a sample strong answer or end with an invitation to ask questions first.', '["recruiter|interviewer|hiring","behavioral|question","one (question )?at a time|one by one|each","\\bstar\\b|grade|score|feedback","posting|job|internship|marketing","tough|hard|strict|realistic|honest"]'::jsonb),
  (3, 2, 'Email to a professor', 'You missed Tuesday’s lecture with a fever and need the slides. You have an email you once sent a professor that landed well.', 'Get the AI to write a short, polite email asking for the slides, without over-apologizing.', 'Strong prompt: states the situation (missed Tuesday with a fever), asks for an email asking for the slides, sets a word limit like under 100 words and a polite but not groveling tone, adds rules such as no over-apologizing, and pastes the liked email as an example to match.', '["professor|prof\\b|instructor","email","missed|absent|fever|sick|tuesday","slides|notes|lecture","polite|respectful|professional|tone|friendly","\\d+ words|short|brief|concise|under","apolog|sorry|groveling|grovelling"]'::jsonb),
  (4, 3, 'Dorm-room chef', 'It is 11 p.m., the dining hall is closed, and your mini fridge has eggs, shredded cheese, one tortilla, leftover rice, and hot sauce. You have a microwave and a mug. No stove.', 'Get the AI to give you a late-night recipe you can actually make with only what you have, in under 10 minutes.', 'Strong prompt: lists the exact ingredients and equipment (microwave and a mug, no stove), sets a time limit like under 10 minutes, asks for a short ingredient list and numbered steps with microwave times, says to use only what is listed and not to add anything else, sets a fun or casual tone, and may describe a flavor or format they like (for example spicy, like a breakfast burrito) or ask for one backup option, ending with an invitation to ask questions first.', '["recipe|snack|meal|cook|make","microwave|mug","egg|cheese|tortilla|rice|hot sauce","\\bonly\\b|don''t add|do not add|nothing else|no stove|without","\\d+ ?(min|minutes)|quick|fast|under","step|numbered|list|instructions","spicy|flavor|taste|like a|burrito|example"]'::jsonb),
  (5, 4, 'Spring break road trip', 'You and three friends want a 4-day spring break road trip from Bloomington. You have one car, about $250 each, and nobody wants to drive more than 5 hours in a day.', 'Get the AI to plan a fun day-by-day itinerary that fits the budget and the driving limit.', 'Strong prompt: states the start city, group size, number of days, budget per person, and the 5-hour daily driving limit; says what the group likes (for example food, hiking, concerts, beaches); asks for a day-by-day table with drive time, stops, and estimated cost; adds rules such as stay under budget, no day over 5 hours of driving, and flag anything that needs a reservation; may give an example of a past trip they loved or a sample table row, and ends with an invitation to ask questions first.', '["trip|itinerary|road|travel","bloomington|indiana","\\d+ ?(day|days)|four days|4-day|day by day|day-by-day","budget|\\$|cost|cheap|afford","\\d+ ?hours?|drive|driving","table|schedule|plan|list","friends|group|four of us|4 of us|people"]'::jsonb),
  (6, 5, 'Haunted campus adventure', 'You have a free evening and want the AI to run a choose-your-own-adventure game for you, set on a spooky version of the IU campus on Halloween night.', 'Get the AI to act as the game master and run an interactive story that stops and waits for your choice at every turn.', 'Strong prompt: makes the AI the game master, sets the scene (haunted IU campus on Halloween night) and the player''s character, asks for short scenes (for example under 120 words) that each end with 2 to 4 numbered choices, adds rules such as wait for my choice before continuing, keep it spooky but not gory, track an inventory or health, and wrap up within about 10 turns; may name a style to match (like Goosebumps or Stranger Things) or give a sample scene, and invites questions first.', '["game master|narrator|dungeon master|\\bgm\\b|\\bdm\\b|run (a|the) game|act as|you are","adventure|story|game","spooky|halloween|haunted|ghost|campus|\\biu\\b|indiana","choice|choose|option|\\d+ (choices|options)","wait for|one (scene|turn) at a time|my (choice|answer|move)","\\d+ ?(words|turns|sentences)|short|brief","like|style|goosebumps|stranger things|example|tone"]'::jsonb)
on conflict (id) do update set position = excluded.position, title = excluded.title, situation = excluded.situation,
  goal = excluded.goal, grader_notes = excluded.grader_notes, must = excluded.must;
