-- Isolated Space Shooter hardening. No modifications to other applications' objects.
alter table public.ss_profiles
  add column if not exists bale_verified_at timestamptz,
  add column if not exists bale_user_id bigint;
create unique index if not exists ss_profiles_unique_verified_bale_id
  on public.ss_profiles(bale_user_id) where bale_user_id is not null;

alter table public.ss_orders
  add column if not exists precheckout_tx text,
  add column if not exists precheckout_payer bigint,
  add column if not exists precheckout_at timestamptz,
  add column if not exists payment_noticed_at timestamptz,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists reconciliation_attempts integer not null default 0;
create unique index if not exists ss_orders_unique_precheckout_tx
 on public.ss_orders(precheckout_tx) where precheckout_tx is not null;
create index if not exists ss_orders_reconciliation_queue
 on public.ss_orders(last_reconciled_at,precheckout_at)
 where status='pending' and precheckout_tx is not null;

-- A Bale contact alone does not verify a web account. Consume its one-time code
-- and bind the verified Bale sender atomically.
create or replace function public.ss_confirm_bale_link(p_user uuid,p_code text,p_bale bigint)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare v_code public.ss_link_codes%rowtype; v_existing bigint;
begin
 if p_bale is null or p_bale<=0 then raise exception 'Invalid Bale sender'; end if;
 select * into v_code from public.ss_link_codes
 where code=p_code and user_id=p_user for update;
 if not found or v_code.consumed_at is not null or v_code.expires_at<=now()
 then return false; end if;
 select bale_user_id into v_existing from public.ss_profiles
 where id=p_user and active for update;
 if not found then return false; end if;
 if v_existing is not null and v_existing<>p_bale then
   raise exception 'Bale account already linked; contact support';
 end if;
 update public.ss_profiles
 set bale_user_id=p_bale,bale_verified_at=now()
 where id=p_user;
 update public.ss_link_codes set consumed_at=now()
 where code=p_code;
 return true;
end $fn$;
revoke all on function public.ss_confirm_bale_link(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.ss_confirm_bale_link(uuid,text,bigint) to service_role;

-- Preserve a unique provider ID even if the successful-payment update is delayed
-- or never delivered. Only the service-role webhook may call this RPC.
create or replace function public.ss_record_checkout
 (p_order uuid,p_transaction text,p_amount bigint,p_payer bigint,p_notice boolean default false)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare v_order public.ss_orders%rowtype; v_verified bigint;
begin
 if p_transaction is null or length(p_transaction)<3 or length(p_transaction)>256
 or p_payer is null or p_payer<=0 then raise exception 'Invalid payment evidence'; end if;
 select * into v_order from public.ss_orders where id=p_order for update;
 if not found or v_order.amount_rial<>p_amount
 or v_order.bale_chat_id is distinct from p_payer
 or v_order.status not in ('pending','paid') then return false; end if;
 select bale_user_id into v_verified from public.ss_profiles where id=v_order.user_id;
 if v_verified is distinct from p_payer then return false; end if;
 if v_order.provider_tx is not null and v_order.provider_tx<>p_transaction
 or v_order.precheckout_tx is not null and v_order.precheckout_tx<>p_transaction
 or v_order.precheckout_payer is not null and v_order.precheckout_payer<>p_payer
 then return false; end if;
 if v_order.status='paid' then return v_order.provider_tx=p_transaction; end if;
 update public.ss_orders
 set precheckout_tx=p_transaction,precheckout_payer=p_payer,
     precheckout_at=coalesce(precheckout_at,now()),
     payment_noticed_at=case when p_notice then coalesce(payment_noticed_at,now())
                            else payment_noticed_at end
 where id=p_order;
 return true;
end $fn$;
revoke all on function public.ss_record_checkout(uuid,text,bigint,bigint,boolean) from public,anon,authenticated;
grant execute on function public.ss_record_checkout(uuid,text,bigint,bigint,boolean) to service_role;

create or replace function public.ss_close_verified_failed_payment(p_order uuid,p_transaction text)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare v_coupon text; v_status text; v_tx text; v_notice timestamptz;
begin
 select status,discount_code,precheckout_tx,payment_noticed_at
 into v_status,v_coupon,v_tx,v_notice
 from public.ss_orders where id=p_order for update;
 if not found or v_status<>'pending' or v_tx is distinct from p_transaction
 or v_notice is not null then return false; end if;
 update public.ss_orders set status='failed' where id=p_order;
 if v_coupon is not null then
   update public.ss_discounts set used_count=greatest(0,used_count-1)
   where code=v_coupon;
 end if;
 return true;
end $fn$;
revoke all on function public.ss_close_verified_failed_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.ss_close_verified_failed_payment(uuid,text) to service_role;

-- Never grant a positive settlement unless it matches the provider's checkout
-- evidence as well as the amount and locked order.
create or replace function public.ss_settle_order(p_order uuid,p_transaction text,p_amount bigint)
returns uuid language plpgsql security definer set search_path='' as $fn$
declare v_order public.ss_orders%rowtype; v_account bigint;
begin
 if p_transaction is null or length(p_transaction)<3 then
  raise exception 'Invalid provider transaction'; end if;
 select * into v_order from public.ss_orders where id=p_order for update;
 if not found or v_order.amount_rial<>p_amount then
  raise exception 'Payment does not match order'; end if;
 if v_order.status='paid' then
  if v_order.provider_tx is distinct from p_transaction then
   raise exception 'Transaction does not match settled order'; end if;
  return v_order.user_id;
 end if;
 if v_order.status<>'pending' or v_order.precheckout_tx is distinct from p_transaction
 or v_order.precheckout_payer is distinct from v_order.bale_chat_id
 then raise exception 'Checkout evidence missing or order not payable'; end if;
 select bale_user_id into v_account from public.ss_profiles where id=v_order.user_id;
 if v_account is distinct from v_order.bale_chat_id then
  raise exception 'Bale account no longer linked'; end if;
 update public.ss_orders set status='paid',provider_tx=p_transaction,paid_at=now()
 where id=p_order;
 perform public.ss_post_ledger(v_order.user_id,v_order.coins,'bale_purchase','bale:'||p_order::text);
 return v_order.user_id;
end $fn$;
revoke all on function public.ss_settle_order(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.ss_settle_order(uuid,text,bigint) to service_role;

-- Reject purchases from a web account that has not verified its phone with
-- the matching Bale sender and one-time link code.
create or replace function public.ss_create_order(p_user uuid,p_chat bigint,p_coins int,p_coupon text)
returns table(order_id uuid,amount_rial bigint)
language plpgsql security definer set search_path='' as $fn$
declare v_price bigint; v_amount bigint; v_discount public.ss_discounts%rowtype; v_id uuid; v_profile public.ss_profiles%rowtype;
begin
 if p_coins is null or p_coins<1 or p_coins>100000 then raise exception 'Invalid coin quantity'; end if;
 select * into v_profile from public.ss_profiles where id=p_user for share;
 if not found or not v_profile.active or v_profile.bale_verified_at is null
 or v_profile.bale_user_id is distinct from p_chat then
   raise exception 'Verified Bale account required'; end if;
 select price_rial_per_coin into v_price from public.ss_settings where id=true;
 if v_price is null or v_price<1 or v_price>floor(9223372036854775807::numeric/p_coins)
 then raise exception 'Coin sales are not configured'; end if;
 v_amount:=v_price*p_coins;
 if p_coupon is not null and length(trim(p_coupon))>0 then
   select * into v_discount from public.ss_discounts where code=upper(trim(p_coupon)) for update;
   if not found or not v_discount.active
    or (v_discount.valid_from is not null and now()<v_discount.valid_from)
    or (v_discount.valid_until is not null and now()>v_discount.valid_until)
    or (not v_discount.unlimited and (v_discount.max_uses is null or v_discount.used_count>=v_discount.max_uses))
   then raise exception 'Discount code invalid or expired'; end if;
   if v_discount.kind='percent' then v_amount:=v_amount-(v_amount*v_discount.value/100);
   else v_amount:=v_amount-v_discount.value; end if;
   v_amount:=greatest(1,v_amount);
   update public.ss_discounts set used_count=used_count+1 where code=v_discount.code;
 end if;
 insert into public.ss_orders(user_id,bale_chat_id,coins,amount_rial,discount_code)
 values(p_user,p_chat,p_coins,v_amount,nullif(upper(trim(p_coupon)),''))
 returning id into v_id;
 return query select v_id,v_amount;
end $fn$;
revoke all on function public.ss_create_order(uuid,bigint,int,text) from public,anon,authenticated;
grant execute on function public.ss_create_order(uuid,bigint,int,text) to service_role;

-- Tighter result validation: client reports cannot exceed server duration,
-- health and score must be internally consistent. This is NOT a full
-- authoritative game replay; untrusted clients can still spoof play.
create or replace function public.ss_finish_verified_run
 (p_user uuid,p_run uuid,p_kills int,p_score int,p_won boolean,p_hearts int,p_elapsed double precision)
returns table(reward bigint,score int,unlocked boolean)
language plpgsql security definer set search_path='' as $fn$
declare v_stage int; v_started timestamptz; v_finished timestamptz;
 v_count int; v_first boolean; v_reward bigint:=0; v_wall double precision;
 v_expected_score int; v_ledger bigint;
begin
 select stage,started_at,finished_at into v_stage,v_started,v_finished
 from public.ss_runs where id=p_run and user_id=p_user for update;
 if v_stage is null or v_finished is not null then raise exception 'Invalid or completed run'; end if;
 v_wall:=extract(epoch from (now()-v_started));
 v_count:=8+least(12,v_stage/10);
 if p_kills is null or p_kills<0 or p_kills>v_count
 or p_score is null or p_score<0 or p_score>100
 or p_hearts is null or p_hearts<0 or p_hearts>5
 or p_elapsed is null or p_elapsed='NaN'::float8 or p_elapsed<0
 or p_elapsed>v_wall+3 or p_elapsed>1800
 or v_wall<8 or v_wall>1800
 or (p_won and (p_hearts<1 or p_kills<>v_count or p_elapsed<8))
 or (not p_won and p_hearts<>0)
 then raise exception 'Invalid game result'; end if;
 v_expected_score:=case when p_won
  then greatest(0,least(100,(100-(5-p_hearts)*9-floor(greatest(0,p_elapsed-38)*0.35))::int))
  else 0 end;
 if p_score<>v_expected_score then raise exception 'Score does not match game results'; end if;
 update public.ss_runs set finished_at=now(),kills=p_kills,score=p_score,won=p_won where id=p_run;
 if p_won and p_score>=75 then
   select not exists(select 1 from public.ss_progress where user_id=p_user and stage=v_stage and cleared)
   into v_first;
   insert into public.ss_progress(user_id,stage,best_score,cleared,completed_at)
   values(p_user,v_stage,p_score,true,now())
   on conflict(user_id,stage) do update
   set best_score=greatest(public.ss_progress.best_score,excluded.best_score),cleared=true;
   if v_first then
    v_reward:=p_kills*10+p_score*2;
    v_ledger:=public.ss_post_ledger(p_user,v_reward,'first_clear',
       'level:'||p_user::text||':'||v_stage::text);
    if v_ledger is null then v_reward:=0; end if;
   end if;
 else
   insert into public.ss_progress(user_id,stage,best_score,cleared)
   values(p_user,v_stage,p_score,false)
   on conflict(user_id,stage) do update
   set best_score=greatest(public.ss_progress.best_score,excluded.best_score);
 end if;
 return query select v_reward,p_score,(p_won and p_score>=75);
end $fn$;
revoke all on function public.ss_finish_verified_run(uuid,uuid,int,int,boolean,int,double precision) from public,anon,authenticated;
grant execute on function public.ss_finish_verified_run(uuid,uuid,int,int,boolean,int,double precision) to service_role;
revoke execute on function public.ss_finish_run(uuid,uuid,int,int,boolean) from service_role;
