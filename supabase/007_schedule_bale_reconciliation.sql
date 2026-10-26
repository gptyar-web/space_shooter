-- Dedicated reconciliation job: the secret is generated in DB and stored in
-- Vault (never in Git). No other application's cron jobs are modified.
do $block$
declare v_secret text; v_id uuid;
begin
 insert into public.ss_private_config(name,secret)
 values('reconcile_secret',encode(gen_random_bytes(32),'hex'))
 on conflict (name) do nothing;
 select secret into v_secret from public.ss_private_config where name='reconcile_secret';
 select id into v_id from vault.secrets where name='ss_reconcile_cron_secret';
 if v_id is null then
   perform vault.create_secret(v_secret,'ss_reconcile_cron_secret','Space Shooter private payment reconciliation');
 end if;
end $block$;
select cron.schedule('ss_bale_reconcile_15m','*/15 * * * *',
 $schedule$
 select net.http_post(
  url:='https://efibfevyiepkwpnobaro.supabase.co/functions/v1/space-shooter-bale?mode=reconcile',
  headers:=jsonb_build_object(
    'Content-Type','application/json',
    'x-ss-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='ss_reconcile_cron_secret')
  ),
  body:='{}'::jsonb,
  timeout_milliseconds:=20000
 );
 $schedule$);
