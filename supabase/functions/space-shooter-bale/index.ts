import {createClient} from "npm:@supabase/supabase-js@2.58.0";
const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
function must<T>(x:{data:T,error:any}):T{if(x.error)throw Error(x.error.message);return x.data;}
async function secret(name:string){return (await db.from("ss_private_config").select("secret").eq("name",name).maybeSingle()).data?.secret||"";}
let token="";
async function bale(method:string,parameters:Record<string,unknown>){
 const res=await fetch("https://tapi.bale.ai/bot"+token+"/"+method,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(parameters)});
 const j=await res.json();if(!j.ok)throw Error("Bale "+method+": "+String(j.description||"failed"));return j.result;
}
async function say(chat_id:number,text:string,extra:Record<string,unknown>={}){return bale("sendMessage",{chat_id,text,...extra});}
const contactKeyboard={keyboard:[[{text:"📱 ارسال شماره موبایل من",request_contact:true}]],resize_keyboard:true,one_time_keyboard:true};
function normalizePhone(phone:string){let p=phone.replace(/[^\d+]/g,"");if(p.startsWith("+98"))p="0"+p.slice(3);if(p.startsWith("98"))p="0"+p.slice(2);return p;}
async function saveSession(chat_id:number,updates:any){must(await db.from("ss_bale_sessions").upsert({chat_id,...updates,updated_at:new Date().toISOString()}));}
async function start(chat_id:number){await saveSession(chat_id,{state:"need_contact",user_id:null,coins:null,coupon:null});await say(chat_id,"به بازوی خرید سکه Space Shooter خوش آمدید! برای شناسایی حساب، با دکمه زیر شماره بله خودتان را به اشتراک بگذارید.",{reply_markup:contactKeyboard});}
async function makeInvoice(chat:number,s:any,coupon:string|null){
 const {data,error}=await db.rpc("ss_create_order",{p_user:s.user_id,p_chat:chat,p_coins:s.coins,p_coupon:coupon});if(error){await say(chat,"کد تخفیف یا سفارش معتبر نیست: "+error.message+"\nکد صحیح بفرستید یا «ندارم» بنویسید.");return;}
 const order=Array.isArray(data)?data[0]:data;
 if(!order)throw Error("Order not created");
 const provider=await secret("provider_token");if(!provider){await say(chat,"درگاه کیف پول هنوز توسط مدیر تنظیم نشده است.");return;}
 await bale("sendInvoice",{chat_id:chat,title:"سکه بازی Space Shooter",
 description:String(s.coins)+" سکه برای حساب بازی",payload:order.order_id,provider_token:provider,prices:[{label:String(s.coins)+" سکه",amount:order.amount_rial}]});
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
  const link=(await db.from("ss_link_codes").select("*").eq("code",code).eq("user_id",s.user_id).is("consumed_at",null).gt("expires_at",new Date().toISOString()).maybeSingle()).data;
  if(!link){await say(chat,"کد اتصال نامعتبر یا منقضی شده است. کد جدید از حساب بازی بگیرید.");return;}
  must(await db.from("ss_link_codes").update({consumed_at:new Date().toISOString()}).eq("code",code).is("consumed_at",null));
  const p=must(await db.from("ss_profiles").select("first_name,last_name").eq("id",s.user_id).single());
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
 const good=!!order&&order.status==="pending"&&order.amount_rial===Number(q.total_amount)&&q.currency==="IRR"&&order.bale_chat_id===Number(q.from?.id);
 return bale("answerPreCheckoutQuery",{pre_checkout_query_id:q.id,ok:good,...(good?{}:{error_message:"مبلغ یا سفارش تأیید نشد."})});
}
async function onPayment(msg:any){
 const payment=msg.successful_payment,chat=Number(msg.chat?.id);
 const id=String(payment?.invoice_payload||""), tx=String(payment?.telegram_payment_charge_id||"");
 const order=(await db.from("ss_orders").select("*").eq("id",id).maybeSingle()).data;
 if(!order||order.bale_chat_id!==chat||payment.currency!=="IRR"||Number(payment.total_amount)!==order.amount_rial||!tx)throw Error("Unmatched payment");
 if(order.status==="paid"){await say(chat,"سکه‌های این سفارش قبلاً افزوده شده‌اند.");return;}
 const result=await bale("inquireTransaction",{transaction_id:tx});
 if(result.status!=="paid"||Number(result.amount)!==order.amount_rial||Number(result.userID)!==Number(msg.from?.id))throw Error("Payment not yet verified");
 must(await db.rpc("ss_settle_order",{p_order:order.id,p_transaction:tx,p_amount:order.amount_rial}));
 await saveSession(chat,{state:"need_coins",coins:null,coupon:null});
 await say(chat,"پرداخت با موفقیت استعلام شد ✅ "+order.coins+" سکه به موجودی شما افزوده شد.\nشماره سفارش: "+order.id+"\nبرای خرید دوباره تعداد سکه را بفرستید.");
}
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return new Response("Not allowed",{status:405});
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