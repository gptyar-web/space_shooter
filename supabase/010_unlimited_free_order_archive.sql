-- Space Shooter 5.4.3: remove the 500-coin cap from full discounts.
-- All financial rows and coupon usage are preserved.
create or replace function public.ss_create_order(p_user uuid,p_chat bigint,p_coins int,p_coupon text)
returns table(order_id uuid,amount_rial bigint)
language plpgsql security definer set search_path='' as $fn$
declare v_price bigint; v_amount bigint; v_discount public.ss_discounts%rowtype;
 v_id uuid; v_profile public.ss_profiles%rowtype; v_code text; v_free boolean:=false; v_ledger bigint;
begin
 if p_coins is null or p_coins<1 or p_coins>100000 then raise exception 'Invalid coin quantity'; end if;
 select * into v_profile from public.ss_profiles where id=p_user for share;
 if not found or not v_profile.active or v_profile.bale_verified_at is null
 or v_profile.bale_user_id is distinct from p_chat then
  raise exception 'Verified Bale account required';
 end if;
 select price_rial_per_coin into v_price from public.ss_settings where id=true;
 if v_price is null or v_price<1 or v_price>floor(9223372036854775807::numeric/p_coins)
 then raise exception 'Coin sales are not configured'; end if;
 v_amount:=v_price*p_coins;
 v_code:=nullif(upper(trim(p_coupon)),'');
 if v_code is not null then
  select * into v_discount from public.ss_discounts where code=v_code for update;
  if not found or not v_discount.active
   or (v_discount.valid_from is not null and now()<v_discount.valid_from)
   or (v_discount.valid_until is not null and now()>v_discount.valid_until)
   or (not v_discount.unlimited and
     (v_discount.max_uses is null or v_discount.used_count>=v_discount.max_uses))
  then raise exception 'Discount code invalid, exhausted or expired'; end if;
  if v_discount.kind='percent' then
   v_free:=v_discount.value=100;
   v_amount:=v_amount-floor(v_amount::numeric*v_discount.value/100)::bigint;
  else
   v_amount:=greatest(1,v_amount-v_discount.value);
  end if;
  if v_free then
   -- No special 500-coin cap: only the general 1..100000 order quantity limit applies.
   if exists(select 1 from public.ss_orders where user_id=p_user
      and discount_code=v_code and status='paid' and amount_rial=0)
   then raise exception 'This free coupon has already been redeemed on this account'; end if;
  end if;
 end if;
 if not v_free and v_amount<10000 then
  raise exception 'Bale minimum invoice is 10000 IRR; choose more coins or another discount';
 end if;
 -- Discount row is locked across the full transaction, including coupon
 -- reservation and free settlement. Any failure rolls both back.
 if v_code is not null then
  update public.ss_discounts set used_count=used_count+1 where code=v_code;
 end if;
 insert into public.ss_orders(user_id,bale_chat_id,coins,amount_rial,discount_code,status,paid_at)
 values(p_user,p_chat,p_coins,v_amount,v_code,
        case when v_free then 'paid' else 'pending' end,
        case when v_free then now() else null end)
 returning id into v_id;
 if v_free then
  v_ledger:=public.ss_post_ledger(p_user,p_coins,'free_coupon','free_coupon:'||v_id::text);
  if v_ledger is null then raise exception 'Failed to record free coupon grant'; end if;
 end if;
 return query select v_id,v_amount;
end $fn$;
revoke all on function public.ss_create_order(uuid,bigint,int,text) from public,anon,authenticated;
grant execute on function public.ss_create_order(uuid,bigint,int,text) to service_role;

-- Administrative "delete" means hide from the regular admin list.
-- Orders, payer evidence, ledger entries and existing payment reconciliation
-- must survive; archived pending orders can still settle automatically.
alter table public.ss_orders
 add column if not exists archived_at timestamptz,
 add column if not exists archived_by uuid references public.ss_profiles(id);

create index if not exists ss_orders_admin_active
 on public.ss_orders(created_at desc,id desc) where archived_at is null;
create index if not exists ss_orders_admin_archived
 on public.ss_orders(archived_at desc,id desc) where archived_at is not null;

create table if not exists public.ss_order_archive_events(
 id bigint generated always as identity primary key,
 order_id uuid not null references public.ss_orders(id) on delete restrict,
 admin_id uuid not null references public.ss_profiles(id),
 action text not null check(action in ('archive','restore')),
 reason text,
 created_at timestamptz not null default now()
);
create index if not exists ss_order_archive_events_order
 on public.ss_order_archive_events(order_id,created_at desc);
alter table public.ss_order_archive_events enable row level security;
revoke all on public.ss_order_archive_events from public,anon,authenticated;
grant select,insert on public.ss_order_archive_events to service_role;
grant usage,select on sequence public.ss_order_archive_events_id_seq to service_role;

create or replace function public.ss_admin_archive_order(
 p_admin uuid,p_order uuid,p_archive boolean,p_reason text default null)
returns boolean
language plpgsql security definer set search_path='' as $fn$
declare v_previous timestamptz;
begin
 if p_admin is null or p_order is null or p_archive is null then
  raise exception 'Missing order archival parameters';
 end if;
 if not exists (
  select 1 from public.ss_admins a
  join public.ss_profiles p on p.id=a.id
  where a.id=p_admin and p.active
 ) then
  raise exception 'Administrator permission required';
 end if;
 select archived_at into v_previous from public.ss_orders
 where id=p_order for update;
 if not found then raise exception 'Order not found'; end if;
 if (v_previous is not null)=p_archive then return false; end if;
 update public.ss_orders
 set archived_at=case when p_archive then now() else null end,
     archived_by=case when p_archive then p_admin else null end
 where id=p_order;
 insert into public.ss_order_archive_events(order_id,admin_id,action,reason)
 values(p_order,p_admin,case when p_archive then 'archive' else 'restore' end,
 nullif(left(trim(coalesce(p_reason,'')),300),''));
 return true;
end $fn$;
revoke all on function public.ss_admin_archive_order(uuid,uuid,boolean,text)
 from public,anon,authenticated;
grant execute on function public.ss_admin_archive_order(uuid,uuid,boolean,text)
 to service_role;
