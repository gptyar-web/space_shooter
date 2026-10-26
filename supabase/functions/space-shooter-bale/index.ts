import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const PROJECT_URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(PROJECT_URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
function must<T>(x:{data:T,error:any}):T{if(x.error)throw Error(x.error.message);return x.data;}
async function secret(name:string){return (await db.from("ss_private_config").select("secret").eq("name",name).maybeSingle()).data?.secret||"";}
let token="";
class BaleResponseError extends Error{}
async function bale(method:string,parameters:Record<string,unknown>){
 const res=await fetch("https://tapi.bale.ai/bot"+token+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(parameters)});
 const j=await res.json();if(!j.ok)throw new BaleResponseError("Bale "+method+": "+String(j.description||"failed"));return j.result;
}
async function say(chat_id:number,text:string,extra:Record<string,unknown>={}){return bale("sendMessage",{chat_id,text,...extra});}
const contactKeyboard={keyboard:[[{text:"📱 ارسال شماره موبایل من",request_contact:true}]],resize_keyboard:true,one_time_keyboard:true};
function normalizePhone(phone:string){let p=phone.replace(/[^\d+]/g,"");if(p.startsWith("+98"))p="0"+p.slice(3);if(p.startsWith("98"))p="0"+p.slice(2);return p;}
async function saveSession(chat_id:number,updates:any){
 // A partial upsert can clear columns that are not supplied (especially user_id).
 const existing=must(await db.from("ss_bale_sessions").select("*").eq("chat_id",chat_id).maybeSingle());
 must(await db.from("ss_bale_sessions").upsert({...existing,chat_id,...updates,updated_at:new Date().toISOString()},{onConflict:"chat_id"}));
}
async function start(chat_id:number){await saveSession(chat_id,{state:"need_contact",user_id:null,coins:null,coupon:null});await say(chat_id,"به بازوی خرید سکه Space Shooter خوش آمدید! برای شناسایی حساب، با دکمه زیر شماره بله خودتان را به اشتراک بگذارید.",{reply_markup:contactKeyboard});}
async function makeInvoice(chat:number,s:any,coupon:string|null){
 const provider=await secret("provider_token");
 if(!provider){await say(chat,"درگاه کیف پول هنوز توسط مدیر تنظیم نشده است.");return;}
 const {data,error}=await db.rpc("ss_create_order",{p_user:s.user_id,p_chat:chat,p_coins:s.coins,p_coupon:coupon});if(error){await say(chat,"کد تخفیف یا سفارش معتبر نیست: "+error.message+"\nکد صحیح بفرستید یا «ندارم» بنویسید.");return;}
 const order=Array.isArray(data)?data[0]:data;
 if(!order)throw Error("Order not created");
 try{
  await bale("sendInvoice",{chat_id:chat,title:"سکه بازی Space Shooter",
  description:String(s.coins)+" سکه برای حساب بازی",payload:order.order_id,provider_token:provider,currency:"IRR",prices:[{label:String(s.coins)+" سکه",amount:order.amount_rial}]});
 }catch(error){
  // Only a definitive Bale API rejection allows refunding the reserved coupon.
  // A timeout may mean the invoice was delivered; keep it pending for review.
  console.error("SpaceShooter invoice delivery failed",error instanceof Error?error.message:error);
  if(error instanceof BaleResponseError){
   const cancelled=await db.rpc("ss_cancel_unpaid_invoice",{p_order:order.order_id,p_chat:chat});
   if(cancelled.error)throw Error("Invoice cancellation failed: "+cancelled.error.message);
   await say(chat,"صدور صورتحساب از سوی بله رد شد؛ سفارش لغو شد. دوباره تلاش کنید.");
  }else{
   await say(chat,"وضعیت ارسال صورتحساب مشخص نیست؛ برای جلوگیری از شارژ تکراری سفارش محفوظ مانده است. لطفاً وضعیت را از پشتیبانی پیگیری کنید.");
  }
  return;
 }
 await saveSession(chat,{state:"invoice",coupon});
 await say(chat,"صورتحساب ارسال شد. بعد از پرداخت موفق و تأیید تراکنش، سکه به‌صورت خودکار شارژ می‌شود.");
}
async function onMessage(msg:any){
 const chat=Number(msg.chat?.id),sender=Number(msg.from?.id),text=String(msg.text||"").trim();
 if(!Number.isSafeInteger(chat)||msg.chat?.type!=="private")return;
 if(text.startsWith("/start"))return start(chat);
 const s=(await db.from("ss_bale_sessions").select("*").eq("chat_id",chat).maybeSingle()).data;
 if(!s||s.state==="start")return start(chat);
 if(s.state==="need_contact"){
  const c=msg.contact;
  if(!c||Number(c.user_id)!==sender){await say(chat,"برای امنیت حساب، فقط دکمه «ارسال شماره موبایل من» را بزنید. شماره تایپ‌شده یا مخاطب دیگر پذیرفته نیست.",{reply_markup:contactKeyboard});return;}
  const phone=normalizePhone(String(c.phone_number||""));
  const p=(await db.from("ss_profiles").select("id,first_name,last_name,active,disabled_reason").eq("phone",phone).maybeSingle()).data;
  if(!p){await say(chat,"کاربری با این شماره در بازی پیدا نشد. ابتدا در وب‌سایت ثبت‌نام کنید.");return;}
  if(!p.active){await say(chat,"حساب شما غیرفعال شده است. علت: "+(p.disabled_reason||"توسط مدیریت"));return;}
  await saveSession(chat,{user_id:p.id,state:"need_link"});
  await say(chat,"حساب "+p.first_name+" "+p.last_name+" پیدا شد ✅\nبرای جلوگیری از اتصال شماره شخص دیگر، در بخش «خرید سکه» سایت روی «ساخت کد اتصال» بزنید و کد ۱۲ حرفی را اینجا بفرستید.",{reply_markup:{remove_keyboard:true}});
  return;
 }
 if(s.state==="need_link"){
  const code=text.replaceAll(" ","").toUpperCase();
  const linked=must(await db.rpc("ss_confirm_bale_link",{p_user:s.user_id,p_code:code,p_bale:sender}));
  if(!linked){await say(chat,"کد اتصال نامعتبر یا منقضی شده است. کد جدید از حساب بازی بگیرید.");return;}
  const p=must(await db.from("ss_profiles").select("first_name,last_name").eq("id",s.user_id).single());
   if(!p)throw Error("Linked account not found");
  await saveSession(chat,{state:"need_coins"});
  await say(chat,"سلام "+p.first_name+" "+p.last_name+"! اتصال با موفقیت تأیید شد. چند سکه می‌خواهید بخرید؟ (عدد ۱ تا ۱۰۰۰۰۰)");
  return;
 }
 const p=(await db.from("ss_profiles").select("active,disabled_reason").eq("id",s.user_id).maybeSingle()).data;
 if(!p?.active){await say(chat,"امکان خرید برای حساب غیرفعال وجود ندارد: "+(p?.disabled_reason||"علت نامشخص"));return;}
 if(s.state==="need_coins"){
  const n=Number(text);
  if(!Number.isInteger(n)||n<1||n>100000){await say(chat,"تعداد سکه باید عدد صحیح بین ۱ تا ۱۰۰۰۰۰ باشد.");return;}
  await saveSession(chat,{coins:n,state:"need_discount"});
  await say(chat,"آیا کد تخفیف دارید؟ کد را بنویسید، یا برای ادامه بدون تخفیف «ندارم» ارسال کنید.");
  return;
 }
 if(s.state==="need_discount"){return await makeInvoice(chat,s,["ندارم","خیر","نه","no","NO","-"].includes(text)?null:text.toUpperCase());}
 if(s.state==="invoice"){
  if(text==="خرید مجدد"||text==="/buy"){await saveSession(chat,{state:"need_coins"});await say(chat,"چند سکه می‌خواهید؟");}
  else await say(chat,"در صورت پرداخت، منتظر تأیید خودکار باشید. برای سفارش تازه، «خرید مجدد» ارسال کنید. برای شروع مجدد /start را بزنید.");
 }
}
async function onPrecheckout(q:any){
 const order=(await db.from("ss_orders").select("*").eq("id",String(q.invoice_payload||"")).maybeSingle()).data;
 const profile=order?(await db.from("ss_profiles").select("active,bale_verified_at,bale_user_id").eq("id",order.user_id).maybeSingle()).data:null;
 const payer=Number(q.from?.id),total=Number(q.total_amount);
 let good=!!order&&profile?.active===true&&!!profile?.bale_verified_at
  &&profile.bale_user_id===payer&&order.status==="pending"
  &&order.amount_rial===total&&q.currency==="IRR"&&order.bale_chat_id===payer;
 if(good){
  const saved=await db.rpc("ss_record_checkout",{p_order:order.id,p_transaction:String(q.id||""),p_amount:total,p_payer:payer,p_notice:false});
  good=!saved.error&&saved.data===true;
 }
 return bale("answerPreCheckoutQuery",{pre_checkout_query_id:q.id,ok:good,...(good?{}:{error_message:"مبلغ یا حساب سفارش تأیید نشد."})});
}
function verifiedTransaction(t:any,tx:string,order:any,payer:number){
 return !!t&&t.status==="paid"&&String(t.id)===tx
  &&Number(t.amount)===Number(order.amount_rial)&&Number(t.userID)===payer;
}
async function onPayment(msg:any){
 const payment=msg.successful_payment,chat=Number(msg.chat?.id),payer=Number(msg.from?.id);
 const id=String(payment?.invoice_payload||""),tx=String(payment?.telegram_payment_charge_id||"");
 const order=(await db.from("ss_orders").select("*").eq("id",id).maybeSingle()).data;
 if(!order||order.bale_chat_id!==chat||chat!==payer||payment.currency!=="IRR"
 ||Number(payment.total_amount)!==Number(order.amount_rial)||tx.length<3)throw Error("Unmatched payment");
 if(order.status==="paid"){
  if(order.provider_tx!==tx)throw Error("Transaction ID mismatch");
  return;
 }
 const recorded=must(await db.rpc("ss_record_checkout",{p_order:order.id,p_transaction:tx,
   p_amount:order.amount_rial,p_payer:payer,p_notice:true}));
 if(!recorded)throw Error("Payment notice inconsistent with order");
 const result=await bale("inquireTransaction",{transaction_id:tx});
 if(!verifiedTransaction(result,tx,order,payer))throw Error("Payment not yet verified");
 must(await db.rpc("ss_settle_order",{p_order:order.id,p_transaction:tx,p_amount:order.amount_rial}));
 await saveSession(chat,{state:"need_coins",coins:null,coupon:null});
 try{await say(chat,"پرداخت تأیید شد ✅ "+order.coins+" سکه شارژ شد.\nشماره سفارش: "+order.id+"\nبرای خرید دوباره تعداد سکه را بفرستید.");}
 catch(e){console.error("Payment settled but notification failed",e);}
}
// Invoked periodically by a private Vault-backed pg_cron request. Never infer
// "paid" from a pending invoice or a webhook alone.
async function reconcileOrders(){
 const cutoff=new Date(Date.now()-5*60000).toISOString();
 const rows=must(await db.from("ss_orders")
  .select("id,precheckout_tx,precheckout_payer,bale_chat_id,amount_rial,coins,reconciliation_attempts,last_reconciled_at,payment_noticed_at")
  .eq("status","pending").not("precheckout_tx","is",null)
  .or("last_reconciled_at.is.null,last_reconciled_at.lt."+cutoff)
  .order("last_reconciled_at",{ascending:true,nullsFirst:true}).limit(25));
 let checked=0,paid=0,failed=0,errors=0;
 for(const order of rows){
  checked++;
  const update=await db.from("ss_orders").update({last_reconciled_at:new Date().toISOString(),
   reconciliation_attempts:order.reconciliation_attempts+1}).eq("id",order.id).eq("status","pending");
  if(update.error){errors++;continue;}
  try{
   const info=await bale("inquireTransaction",{transaction_id:order.precheckout_tx});
   if(verifiedTransaction(info,order.precheckout_tx,order,Number(order.precheckout_payer))){
    must(await db.rpc("ss_settle_order",{p_order:order.id,p_transaction:order.precheckout_tx,p_amount:order.amount_rial}));
    paid++;
    try{await say(Number(order.bale_chat_id),"پرداخت شما تأیید و "+order.coins+" سکه واریز شد ✅\nشماره سفارش: "+order.id);}catch(e){console.warn("Bale notification failed",e);}
   }else if(["failed","rejected"].includes(String(info?.status))
    &&String(info?.id)===String(order.precheckout_tx)
    &&Number(info?.amount)===Number(order.amount_rial)
    &&Number(info?.userID)===Number(order.precheckout_payer)){
    const closed=must(await db.rpc("ss_close_verified_failed_payment",{p_order:order.id,p_transaction:order.precheckout_tx}));
    if(closed)failed++;
   }
  }catch(e){errors++;console.error("Bale reconciliation needs retry",order.id,e instanceof Error?e.message:e);}
 }
 return {checked,paid,failed,errors};
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return new Response("Not allowed",{status:405});
 const mode=new URL(req.url).searchParams.get("mode");
 if(mode==="reconcile"){
  const cronSecret=await secret("reconcile_secret");
  if(!cronSecret||req.headers.get("x-ss-cron-secret")!==cronSecret)return new Response("Forbidden",{status:403});
  token=await secret("bot_token");if(!token)return new Response("Not configured",{status:503});
  try{return Response.json({ok:true,data:await reconcileOrders()});}
  catch(e){console.error("SpaceShooter reconciliation failed",e);return Response.json({ok:false},{status:503});}
 }
 const given=new URL(req.url).searchParams.get("secret");
 const expected=await secret("webhook_secret");
 if(!expected||!given||given!==expected)return new Response("Forbidden",{status:403});
 token=await secret("bot_token");if(!token)return new Response("Not configured",{status:503});
 try{
  const update=await req.json(),id=Number(update.update_id);
  if(!Number.isSafeInteger(id))throw Error("Bad update");
  if((await db.from("ss_bale_updates").select("id").eq("id",id).maybeSingle()).data)return new Response('{"ok":true}',{headers:{"Content-Type":"application/json"}});
  if(update.pre_checkout_query)await onPrecheckout(update.pre_checkout_query);
  else if(update.message?.successful_payment)await onPayment(update.message);
  else if(update.message)await onMessage(update.message);
  must(await db.from("ss_bale_updates").insert({id}));
  return new Response('{"ok":true}',{headers:{"Content-Type":"application/json"}});
 }catch(e){console.error("SpaceShooter Bale delivery failure",e instanceof Error?e.message:e);return new Response('{"ok":false}',{status:503,headers:{"Content-Type":"application/json"}});}
});