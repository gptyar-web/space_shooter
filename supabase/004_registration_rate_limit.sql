-- Bounded registration attempts; stored outside Supabase's exposed API schemas.
-- The API hashes phone/IP keys before invoking this service-role-only helper.
create table if not exists ss_private.ss_registration_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0)
);
alter table ss_private.ss_registration_rate_limits enable row level security;
revoke all on ss_private.ss_registration_rate_limits from public, anon, authenticated;

create or replace function public.ss_allow_registration(p_key text,p_limit int,p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare v_attempts integer;
begin
  if p_key !~ '^reg:(global|phone|ip):[A-Za-z0-9_-]{1,70}$'
     or p_limit not between 1 and 500
     or p_window_seconds not between 60 and 86400
  then raise exception 'Invalid rate-limit request'; end if;
  insert into ss_private.ss_registration_rate_limits as r(key,window_start,attempts)
  values(p_key, now(), 1)
  on conflict (key) do update
    set attempts = case when r.window_start <= now() - make_interval(secs => p_window_seconds)
                        then 1 else r.attempts + 1 end,
        window_start = case when r.window_start <= now() - make_interval(secs => p_window_seconds)
                            then now() else r.window_start end
  returning attempts into v_attempts;
  return v_attempts <= p_limit;
end $fn$;

revoke all on function public.ss_allow_registration(text,int,int) from public,anon,authenticated;
grant execute on function public.ss_allow_registration(text,int,int) to service_role;
