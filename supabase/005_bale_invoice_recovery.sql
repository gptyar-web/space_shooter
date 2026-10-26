-- Refund a reserved coupon when Bale explicitly rejects invoice creation.
-- Pending invoices that were actually sent are never cancelled automatically.
create or replace function public.ss_cancel_unpaid_invoice(p_order uuid, p_chat bigint)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare v_coupon text; v_status text;
begin
 select status,discount_code into v_status,v_coupon
 from public.ss_orders
 where id=p_order and bale_chat_id=p_chat
 for update;
 if not found or v_status<>'pending' then return false; end if;
 update public.ss_orders set status='failed' where id=p_order;
 if v_coupon is not null then
   update public.ss_discounts
   set used_count=greatest(0,used_count-1)
   where code=v_coupon;
 end if;
 return true;
end $fn$;
revoke all on function public.ss_cancel_unpaid_invoice(uuid,bigint) from public,anon,authenticated;
grant execute on function public.ss_cancel_unpaid_invoice(uuid,bigint) to service_role;

-- A paid order may be retried only with its original provider transaction.
create or replace function public.ss_settle_order(p_order uuid,p_transaction text,p_amount bigint)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v_uid uuid; v_coins int; v_total bigint; v_state text; v_tx text;
begin
 if p_transaction is null or length(p_transaction)<3 then
   raise exception 'Invalid provider transaction';
 end if;
 select user_id,coins,amount_rial,status,provider_tx
 into v_uid,v_coins,v_total,v_state,v_tx
 from public.ss_orders where id=p_order for update;
 if v_uid is null or v_total<>p_amount then
   raise exception 'Payment does not match order';
 end if;
 if v_state='paid' then
   if v_tx is distinct from p_transaction then
     raise exception 'Transaction does not match settled order';
   end if;
   return v_uid;
 end if;
 if v_state<>'pending' then raise exception 'Order not payable'; end if;
 update public.ss_orders set status='paid',provider_tx=p_transaction,paid_at=now()
 where id=p_order;
 perform public.ss_post_ledger(v_uid,v_coins,'bale_purchase','bale:'||p_order::text);
 return v_uid;
end $fn$;
revoke all on function public.ss_settle_order(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.ss_settle_order(uuid,text,bigint) to service_role;
