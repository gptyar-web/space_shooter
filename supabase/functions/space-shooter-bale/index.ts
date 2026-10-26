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
function invoiceErrorMessage(e:unknown){
 const msg=e instanceof Error?e.message:"";
 if(/total price must be at least 10000/i.test(msg))return "مبلغ پس از تخفیف کمتر از حداقل ۱۰٬۰۰۰ ریال بله است. تعداد سکه را افزایش دهید یا کد دیگری استفاده کنید.";
 if(/provider.token|provider_token|wallet|merchant/i.test(msg))return "تنظیمات دریافت وجه در کیف پول بله باید توسط مدیر بررسی شود.";
 return "درگاه بله صورتحساب را نپذیرفت. شماره سفارش را به پشتیبانی بدهید؛ اگر پرداختی نکرده‌اید، دوباره با تعداد یا کد دیگری تلاش کنید.";
}
async function makeInvoice(chat:number,s:any,coupon:string|null){
 const provider=await secret("provider_token");
 let possiblyFree=false;
 if(coupon){
  const d=(await db.from("ss_discounts").select("kind,value").eq("code",coupon).maybeSingle()).data;
  possiblyFree=d?.kind==="percent"&&d?.value===100;
 }
 if(!provider&&!possiblyFree){await say(chat,"توکن کیف پول بله در تنظیمات مدیر ثبت نشده است؛ صدور صورتحساب ممکن نیست.");return;}
 const {data,error}=await db.rpc("ss_create_order",{p_user:s.user_id,p_chat:chat,p_coins:s.coins,p_coupon:coupon});
 if(error){
  const msg=String(error.message||"");
  if(/minimum|10000 IRR/i.test(msg)){await saveSession(chat,{state:"need_coins",coins:null,coupon:null});await say(chat,"مبلغ نهایی با این تخفیف کمتر از حداقل ۱۰٬۰۰۰ ریال بله است. لطفاً تعداد سکهٔ بیشتری برای سفارش تازه وارد کنید.");}
  else if(/already been redeemed/i.test(msg))await say(chat,"این کد رایگان قبلاً توسط این حساب استفاده شده است. از کد دیگری استفاده کنید.");
  else if(/500 coins/i.test(msg)){await saveSession(chat,{state:"need_coins",coins:null,coupon:null});await say(chat,"هر دریافت رایگان با کد ۱۰۰٪ حداکثر ۵۰۰ سکه است؛ لطفاً تعداد سکه را دوباره وارد کنید.");}
  else await say(chat,"کد تخفیف یا سفارش پذیرفته نشد. وضعیت کد را بررسی کنید یا «ندارم» ارسال کنید.");
  return;
 }
 const order=Array.isArray(data)?data[0]:data;
 if(!order)throw Error("Order not created");
 if(Number(order.amount_rial)===0){
  await saveSession(chat,{state:"need_coins",coins:null,coupon:null});
  await say(chat,"🎁 تخفیف ۱۰۰٪ اعمال شد! "+s.coins+" سکه بدون پرداخت به کیف پول بازی افزوده شد.\nشماره رسید: "+order.order_id+"\nبرای دریافت دوباره تعداد سکه را بفرستید.");
  return;
 }
 if(!provider)throw Error("Paid order created with no provider token");
 if(!Number.isSafeInteger(Number(order.amount_rial))||Number(order.amount_rial)<10000){
  const cancelled=await db.rpc("ss_cancel_unpaid_invoice",{p_order:order.order_id,p_chat:chat});
  if(cancelled.error)throw Error("Unable to cancel invalid invoice");
  await say(chat,"مبلغ صورتحساب کمتر از حداقل مجاز بله است؛ سفارش بدون برداشت وجه لغو شد.");
  return;
 }
 try{
  await bale("sendInvoice",{chat_id:chat,title:"سکه بازی Space Shooter",
   description:String(s.coins)+" سکه برای حساب بازی",payload:order.order_id,provider_token:provider,currency:"IRR",
   prices:[{label:String(s.coins)+" سکه",amount:order.amount_rial}]});
 }catch(error){
  console.error("SpaceShooter invoice delivery failed",error instanceof Error?error.message:error);
  if(error instanceof BaleResponseError){
   const cancelled=await db.rpc("ss_cancel_unpaid_invoice",{p_order:order.order_id,p_chat:chat});
   if(cancelled.error)throw Error("Invoice cancellation failed: "+cancelled.error.message);
   await saveSession(chat,{state:"need_coins",coins:null,coupon:null});
   await say(chat,invoiceErrorMessage(error)+"\nسفارش ردشده لغو شد. برای خرید تازه تعداد سکه را وارد کنید.");
  }else{
   await say(chat,"وضعیت ارسال فاکتور نامشخص است و سفارش برای جلوگیری از خطای مالی محفوظ مانده است؛ لطفاً با پشتیبانی تماس بگیرید. شماره سفارش: "+order.order_id);
  }
  return;
 }
 await saveSession(chat,{state:"invoice",coupon});
 await say(chat,"✅ صورتحساب ارسال شد: "+Number(order.amount_rial).toLocaleString("fa-IR")+" ریال. پس از پرداخت موفق و استعلام تراکنش، سکه خودکار شارژ می‌شود.");
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
 for(const order of rows||[]){
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