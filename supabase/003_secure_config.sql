-- Use a non-exposed, RLS-protected public table for service-role-only REST access.
create table if not exists public.ss_private_config (name text primary key,secret text not null);
alter table public.ss_private_config enable row level security;
revoke all on public.ss_private_config from anon, authenticated;
grant select,insert,update,delete on public.ss_private_config to service_role;