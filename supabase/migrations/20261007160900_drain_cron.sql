-- Backstop: every minute pg_cron calls the drain-queue Edge Function so queued prompts and admin regrades
-- get graded even when no browser is polling. The shared token is generated here and lives only in Vault.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'drain_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'drain_token', 'Shared secret for drain-queue cron calls');
  end if;
end $$;

select cron.schedule(
  'drain-grading-queue',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rndukbzegenpextindwd.supabase.co/functions/v1/drain-queue',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-drain-token', (select decrypted_secret from vault.decrypted_secrets where name = 'drain_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (select 1 from game_private.submissions where status <> 'graded' or regrade_requested);
  $$
);

-- Housekeeping: drop expired rooms and old rate-limit windows nightly (03:15 UTC).
select cron.schedule(
  'cleanup-expired',
  '15 3 * * *',
  $$
  delete from public.games where expires_at < now() - interval '1 day';
  delete from game_private.rate_limits where window_start < now() - interval '2 days';
  $$
);
