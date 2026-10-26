
-- Space Shooter: isolated ss_ tables, no modifications to existing application tables.
create table if not exists public.ss_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique check(username ~ '^[a-z0-9_]{3,24}$'),
 first_name text not null check(length(first_name) between 1 and 70),
 last_name text not null check(length(last_name) between 1 and 70),
 phone text not null unique check(phone ~ '^09[0-9]{9}$'),
 gender text not null check(gender in ('زن','مرد')),
 active boolean not null default true, disabled_reason text,
 created_at timestamptz not null default now()
);
create table if not exists public.ss_admins (id uuid primary key references auth.users(id) on delete cascade);
create table if not exists public.ss_wallets (
 user_id uuid primary key references public.ss_profiles(id) on delete cascade,
 balance bigint not null default 0 check(balance>=0)
);
create table if not exists public.ss_ledger (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.ss_profiles(id) on delete cascade,
 delta bigint not null check(delta<>0),
 reason text not null, ref text not null unique,
 created_at timestamptz not null default now()
);
create index if not exists ss_ledger_owner_time on public.ss_ledger(user_id,created_at desc);
create table if not exists public.ss_progress (
 user_id uuid not null references public.ss_profiles(id) on delete cascade,
 stage smallint not null check(stage between 1 and 200),
 best_score smallint not null check(best_score between 0 and 100),
 cleared boolean not null default false,
 completed_at timestamptz,
 primary key(user_id,stage)
);
create table if not exists public.ss_runs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.ss_profiles(id) on delete cascade,
 stage smallint not null check(stage between 1 and 200),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 kills int, score smallint, won boolean
);
create index if not exists ss_runs_owner on public.ss_runs(user_id,started_at desc);
create table if not exists public.ss_daily_claims (
 user_id uuid primary key references public.ss_profiles(id) on delete cascade,
 streak int not null default 0 check(streak between 0 and 3650),
 claimed_on date
);
create table if not exists public.ss_packages (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(title) between 1 and 90),
 description text not null default '',
 coins bigint not null check(coins>0),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.ss_purchases (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.ss_profiles(id) on delete cascade,
 package_id uuid not null references public.ss_packages(id),
 price bigint not null check(price>0),
 created_at timestamptz not null default now()
);
create table if not exists public.ss_discounts (
 code text primary key,
 kind text not null check(kind in ('percent','rial')),
 value int not null check(value>0),
 valid_from timestamptz, valid_until timestamptz,
 unlimited boolean not null default false,
 max_uses int check(max_uses>0),
 used_count int not null default 0 check(used_count>=0),
 active boolean not null default true,
 check ((kind<>'percent') or (value<=99))
);
create table if not exists public.ss_orders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.ss_profiles(id) on delete cascade,
 bale_chat_id bigint,
 coins int not null check(coins between 1 and 100000),
 amount_rial bigint not null check(amount_rial>0),
 discount_code text references public.ss_discounts(code),
 status text not null default 'pending' check(status in ('pending','paid','failed')),
 provider_tx text unique,
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create index if not exists ss_orders_owner on public.ss_orders(user_id,created_at desc);
create table if not exists public.ss_tickets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.ss_profiles(id) on delete cascade,
 subject text not null check(length(subject) between 3 and 160),
 status text not null default 'sent'
   check(status in ('sent','review','awaiting_user','closed','closed_support')),
 file_limit bigint not null default 31457280 check(file_limit between 0 and 52428800),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.ss_ticket_messages (
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references public.ss_tickets(id) on delete cascade,
 author_id uuid not null references auth.users(id),
 message text not null default '',
 attachment_path text,
 attachment_bytes bigint,
 created_at timestamptz not null default now(),
 check(length(message)>0 or attachment_path is not null)
);
create index if not exists ss_messages_ticket on public.ss_ticket_messages(ticket_id,created_at);
create table if not exists public.ss_announcements (
 id uuid primary key default gen_random_uuid(), title text not null, body text not null,
 active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.ss_settings (
 id boolean primary key default true check(id),
 price_rial_per_coin bigint not null default 0 check(price_rial_per_coin>=0),
 bale_url text not null default '', updated_at timestamptz not null default now()
);
insert into public.ss_settings(id) values(true) on conflict do nothing;
create table if not exists public.ss_bale_sessions (
 chat_id bigint primary key, user_id uuid references public.ss_profiles(id),
 state text not null default 'start', coins int, coupon text,
 link_code text, updated_at timestamptz not null default now()
);
create table if not exists public.ss_bale_updates (id bigint primary key, received_at timestamptz not null default now());
create table if not exists public.ss_link_codes (
 code text primary key, user_id uuid not null references public.ss_profiles(id) on delete cascade,
 expires_at timestamptz not null, consumed_at timestamptz
);
create schema if not exists ss_private;
revoke all on schema ss_private from public, anon, authenticated;
create table if not exists ss_private.config (name text primary key, secret text not null);
revoke all on ss_private.config from public, anon, authenticated;
grant usage on schema ss_private to service_role;
grant all on ss_private.config to service_role;
insert into storage.buckets(id,name,public,file_size_limit)
values('ss-ticket-files','ss-ticket-files',false,52428800)
on conflict (id) do nothing;
-- RLS; only explicit read of owned data. Writes are through server authenticated Edge Functions.
do $ddl$ declare tbl text;
begin foreach tbl in array array[
'ss_profiles','ss_admins','ss_wallets','ss_ledger','ss_progress','ss_runs',
'ss_daily_claims','ss_packages','ss_purchases','ss_discounts','ss_orders',
'ss_tickets','ss_ticket_messages','ss_announcements','ss_settings',
'ss_bale_sessions','ss_bale_updates','ss_link_codes']
loop execute format('alter table public.%I enable row level security',tbl); end loop; end $ddl$;
create policy ss_own_profile on public.ss_profiles for select to authenticated using ((select auth.uid())=id);
create policy ss_own_wallet on public.ss_wallets for select to authenticated using ((select auth.uid())=user_id);
create policy ss_own_ledger on public.ss_ledger for select to authenticated using ((select auth.uid())=user_id);
create policy ss_own_progress on public.ss_progress for select to authenticated using ((select auth.uid())=user_id);
create policy ss_own_runs on public.ss_runs for select to authenticated using ((select auth.uid())=user_id);
create policy ss_own_daily on public.ss_daily_claims for select to authenticated using ((select auth.uid())=user_id);
create policy ss_public_packages on public.ss_packages for select to authenticated using (active);
create policy ss_own_purchases on public.ss_purchases for select to authenticated using ((select auth.uid())=user_id);
create policy ss_own_orders on public.ss_orders for select to authenticated using ((select auth.uid())=user_id);
create policy ss_own_tickets on public.ss_tickets for select to authenticated using ((select auth.uid())=user_id);
create policy ss_own_messages on public.ss_ticket_messages for select to authenticated using (
 exists(select 1 from public.ss_tickets t where t.id=ticket_id and t.user_id=(select auth.uid()))
);
create policy ss_public_announcements on public.ss_announcements for select to authenticated using(active);
create policy ss_public_settings on public.ss_settings for select to authenticated using(true);
-- No authenticated INSERT/UPDATE/DELETE policies by design.
grant select on public.ss_profiles, public.ss_wallets, public.ss_ledger, public.ss_progress,
public.ss_runs, public.ss_daily_claims, public.ss_packages, public.ss_purchases,
public.ss_orders, public.ss_tickets, public.ss_ticket_messages, public.ss_announcements,
public.ss_settings to authenticated;
revoke all on public.ss_admins, public.ss_discounts, public.ss_bale_sessions,
public.ss_bale_updates, public.ss_link_codes from anon, authenticated;
create or replace function public.ss_post_ledger(p_user uuid,p_delta bigint,p_reason text,p_ref text)
returns bigint language plpgsql security definer set search_path='' as $fn$
declare v_id bigint; v_balance bigint;
begin
 if p_delta=0 or length(p_ref)<3 then raise exception 'Invalid ledger entry'; end if;
 insert into public.ss_ledger(user_id,delta,reason,ref) values(p_user,p_delta,p_reason,p_ref)
 on conflict(ref) do nothing returning id into v_id;
 if v_id is null then return null; end if;
 insert into public.ss_wallets(user_id,balance) values(p_user,p_delta)
 on conflict(user_id) do update set balance=public.ss_wallets.balance+excluded.balance
 returning balance into v_balance;
 return v_id;
end $fn$;
revoke all on function public.ss_post_ledger(uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.ss_post_ledger(uuid,bigint,text,text) to service_role;
create or replace function public.ss_buy_package(p_user uuid,p_package uuid)
returns bigint language plpgsql security definer set search_path='' as $fn$
declare v_cost bigint; v_id uuid:=gen_random_uuid();
begin
 select coins into v_cost from public.ss_packages where id=p_package and active for share;
 if v_cost is null then raise exception 'Package unavailable'; end if;
 perform public.ss_post_ledger(p_user,-v_cost,'package', 'package:'||v_id::text);
 insert into public.ss_purchases(id,user_id,package_id,price) values(v_id,p_user,p_package,v_cost);
 return v_cost;
end $fn$;
revoke all on function public.ss_buy_package(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ss_buy_package(uuid,uuid) to service_role;
create or replace function public.ss_claim_daily(p_user uuid)
returns table(reward bigint,streak int) language plpgsql security definer set search_path='' as $fn$
declare v_date date:=(now() at time zone 'Asia/Tehran')::date; v_old date; v_streak int; v_reward bigint;
begin
 insert into public.ss_daily_claims(user_id) values(p_user) on conflict do nothing;
 select claimed_on,d.streak into v_old,v_streak from public.ss_daily_claims d where d.user_id=p_user for update;
 if v_old=v_date then return query select 0::bigint,v_streak; return; end if;
 v_streak:=case when v_old=v_date-1 then least(v_streak+1,3650) else 1 end;
 v_reward:=v_streak::bigint*100;
 update public.ss_daily_claims set claimed_on=v_date,streak=v_streak where user_id=p_user;
 perform public.ss_post_ledger(p_user,v_reward,'daily','daily:'||p_user::text||':'||v_date::text);
 return query select v_reward,v_streak;
end $fn$;
revoke all on function public.ss_claim_daily(uuid) from public,anon,authenticated;
grant execute on function public.ss_claim_daily(uuid) to service_role;
create or replace function public.ss_finish_run(p_user uuid,p_run uuid,p_kills int,p_score int,p_won boolean)
returns table(reward bigint,score int,unlocked boolean) language plpgsql security definer set search_path='' as $fn$
declare v_stage int; v_started timestamptz; v_finished timestamptz; v_prev int; v_count int; v_first boolean; v_reward bigint:=0;
begin
 select stage,started_at,finished_at into v_stage,v_started,v_finished
 from public.ss_runs where id=p_run and user_id=p_user for update;
 if v_stage is null or v_finished is not null then raise exception 'Invalid or completed run'; end if;
 v_count:=8+least(12,v_stage/10);
 if p_kills<0 or p_kills>v_count or p_score<0 or p_score>100
 or now()-v_started<interval '8 seconds' or now()-v_started>interval '30 minutes'
 then raise exception 'Invalid game result'; end if;
 if p_won and p_kills<>v_count then raise exception 'All enemies must be defeated'; end if;
 -- Basic bounded validation only; see README anti-cheat limitation.
 update public.ss_runs set finished_at=now(),kills=p_kills,score=p_score,won=p_won where id=p_run;
 if p_won and p_score>=75 then
  select not exists(select 1 from public.ss_progress where user_id=p_user and stage=v_stage and cleared)
  into v_first;
  insert into public.ss_progress(user_id,stage,best_score,cleared,completed_at)
  values(p_user,v_stage,p_score,true,now())
  on conflict(user_id,stage) do update set best_score=greatest(public.ss_progress.best_score,excluded.best_score),cleared=true;
  if v_first then
    v_reward:=p_kills*10+p_score*2;
    perform public.ss_post_ledger(p_user,v_reward,'first_clear','level:'||p_user::text||':'||v_stage::text);
  end if;
 else
  insert into public.ss_progress(user_id,stage,best_score,cleared)
  values(p_user,v_stage,p_score,false)
  on conflict(user_id,stage) do update set best_score=greatest(public.ss_progress.best_score,excluded.best_score);
 end if;
 return query select v_reward,p_score,(p_won and p_score>=75);
end $fn$;
revoke all on function public.ss_finish_run(uuid,uuid,int,int,boolean) from public,anon,authenticated;
grant execute on function public.ss_finish_run(uuid,uuid,int,int,boolean) to service_role;
create or replace function public.ss_settle_order(p_order uuid,p_transaction text,p_amount bigint)
returns uuid language plpgsql security definer set search_path='' as $fn$
declare v_uid uuid; v_coins int; v_total bigint; v_state text;
begin
 select user_id,coins,amount_rial,status into v_uid,v_coins,v_total,v_state from public.ss_orders where id=p_order for update;
 if v_uid is null or v_total<>p_amount then raise exception 'Payment does not match order'; end if;
 if v_state='paid' then return v_uid; end if;
 if v_state<>'pending' then raise exception 'Order not payable'; end if;
 update public.ss_orders set status='paid',provider_tx=p_transaction,paid_at=now() where id=p_order;
 perform public.ss_post_ledger(v_uid,v_coins,'bale_purchase','bale:'||p_order::text);
 return v_uid;
end $fn$;
revoke all on function public.ss_settle_order(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.ss_settle_order(uuid,text,bigint) to service_role;
