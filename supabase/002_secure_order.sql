-- Order totals and limited coupon uses are computed atomically on the server.
create or replace function public.ss_create_order(p_user uuid,p_chat bigint,p_coins int,p_coupon text)
returns table(order_id uuid,amount_rial bigint) language plpgsql security definer set search_path='' as $fn$
declare v_price bigint; v_amount bigint; v_discount public.ss_discounts%rowtype; v_id uuid;
begin
 if p_coins<1 or p_coins>100000 then raise exception 'Invalid coin quantity'; end if;
 select price_rial_per_coin into v_price from public.ss_settings where id=true;
 if v_price is null or v_price<1 then raise exception 'Coin sales are not configured'; end if;
 v_amount:=v_price*p_coins;
 if p_coupon is not null and length(trim(p_coupon))>0 then
   select * into v_discount from public.ss_discounts where code=upper(trim(p_coupon)) for update;
   if not found or not v_discount.active
   or (v_discount.valid_from is not null and now()<v_discount.valid_from)
   or (v_discount.valid_until is not null and now()>v_discount.valid_until)
   or (not v_discount.unlimited and v_discount.max_uses is not null and v_discount.used_count>=v_discount.max_uses)
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