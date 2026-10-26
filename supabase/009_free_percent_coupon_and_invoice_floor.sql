-- Space Shooter v5.4.2: free-percent coupons and Bale minimum invoice validation.
-- Only ss_ objects are modified; existing orders/balances remain untouched.
alter table public.ss_discounts drop constraint if exists ss_discounts_check;
alter table public.ss_discounts add constraint ss_discounts_percent_range
 check (kind <> 'percent' or value between 1 and 100);

alter table public.ss_orders drop constraint if exists ss_orders_amount_rial_check;
alter table public.ss_orders add constraint ss_orders_amount_rial_check check (amount_rial >= 0);

-- A fully discounted redemption is intentionally limited to once per account
-- for a given coupon. Unlimited-use coupon still supports different users.
create unique index if not exists ss_free_coupon_once_per_account
 on public.ss_orders(user_id,discount_code)
 where amount_rial=0 and status='paid';

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
   if p_coins>500 then raise exception 'Free coupons are limited to 500 coins per redemption'; end if;
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
