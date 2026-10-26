import { createClient } from "npm:@supabase/supabase-js@2.58.0";
const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL, KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const ORIGINS = ["https://gptyar-web.github.io","http://localhost:5173","http://127.0.0.1:5173"];
function headers(req:Request) { const origin=req.headers.get("origin")||"";return {"Access-Control-Allow-Origin":ORIGINS.includes(origin)?origin:"https://gptyar-web.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS","Vary":"Origin","Content-Type":"application/json"}; }
function json(req:Request,data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:headers(req)});}
function requireOk<T>(result:{data:T,error:any}):T{if(result.error)throw new Error(result.error.message);return result.data;}
function fail(message:string):never {throw new Error(message);}
function emailFor(name:string){return "ss-"+name+"@spaceshooter.invalid";}
function onlyString(x:unknown,max=3000){return typeof x==="string"?x.trim().slice(0,max):"";}
function validPhone(p:string){return /^09\d{9}$/.test(p);}
async function currentUser(req:Request){
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)fail("ابتدا وارد حساب شوید.");
 const {data:u,error:userError}=await db.auth.getUser(token);
 if(userError||!u?.user)fail("نشست نامعتبر است.");
 const profile=requireOk(await db.from("ss_profiles").select("*").eq("id",u.user.id).single());
 return profile;
}
async function isAdmin(uid:string){const {data}=await db.from("ss_admins").select("id").eq("id",uid).maybeSingle();return !!data;}
async function allowRegistration(req:Request,phone:string){
 // Hash values so no raw phone number or IP address is retained.
 const hash=async(value:string)=>{
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(KEY+":ss-register:"+value));
  return Array.from(new Uint8Array(buf),x=>x.toString(16).padStart(2,"0")).join("");
 };
 const ip=onlyString((req.headers.get("x-forwarded-for")||"").split(",")[0],48);
 const keys:[string,number,number][]=[["reg:global:all",150,3600],["reg:phone:"+await hash(phone),4,3600]];
 if(ip)keys.push(["reg:ip:"+await hash(ip),12,3600]);
 for(const [p_key,p_limit,p_window_seconds] of keys){
  const allowed=requireOk(await db.rpc("ss_allow_registration",{p_key,p_limit,p_window_seconds}));
  if(!allowed)fail("تعداد تلاش‌ها بیش از حد مجاز است. لطفاً بعداً تلاش کنید.");
 }
}
async function registration(b:any,req:Request){
 const username=onlyString(b.username,24).toLowerCase();
 const first_name=onlyString(b.first_name,70),last_name=onlyString(b.last_name,70),phone=onlyString(b.phone,11),gender=b.gender;
 const password=String(b.password||"");
 if(!/^[a-z0-9_]{3,24}$/.test(username)||!first_name||!last_name||!validPhone(phone)||!["زن","مرد"].includes(gender)||password.length<10||password.length>128) fail("مشخصات نامعتبر است؛ رمز حداقل ۱۰ کاراکتر لازم دارد.");
  await allowRegistration(req,phone);
 const {data:old}=await db.from("ss_profiles").select("id").or("username.eq."+username+",phone.eq."+phone).limit(1);
 if(old?.length)fail("نام کاربری یا شماره موبایل قبلاً ثبت شده است.");
 const {data:auth,error:signupError}=await db.auth.admin.createUser({email:emailFor(username),password,email_confirm:true});
  if(signupError||!auth?.user)fail("ساخت حساب ناموفق بود.");
 const uid=auth.user.id;
 try{
  requireOk(await db.from("ss_profiles").insert({id:uid,username,first_name,last_name,phone,gender}));
  requireOk(await db.from("ss_wallets").insert({user_id:uid,balance:0}));
 }catch(e){await db.auth.admin.deleteUser(uid);throw e;}
 return {created:true};
}
async function bootstrap(p:any){
 if(!p.active)return {profile:p,disabled:true};
 const [wallet,progress,daily,settings,packages,announcements,ledger,orders,tickets,purchases]=await Promise.all([
 db.from("ss_wallets").select("balance").eq("user_id",p.id).single(),
 db.from("ss_progress").select("stage,best_score,cleared").eq("user_id",p.id),
 db.from("ss_daily_claims").select("streak,claimed_on").eq("user_id",p.id).maybeSingle(),
 db.from("ss_settings").select("price_rial_per_coin,bale_url").eq("id",true).single(),
 db.from("ss_packages").select("*").eq("active",true).order("created_at",{ascending:false}),
 db.from("ss_announcements").select("*").eq("active",true).order("created_at",{ascending:false}).limit(6),
 db.from("ss_ledger").select("*").eq("user_id",p.id).order("created_at",{ascending:false}).limit(100),
 db.from("ss_orders").select("*").eq("user_id",p.id).order("created_at",{ascending:false}).limit(100),
 db.from("ss_tickets").select("*").eq("user_id",p.id).order("updated_at",{ascending:false}).limit(60),
 db.from("ss_purchases").select("*").eq("user_id",p.id).order("created_at",{ascending:false}).limit(60)
 ]);
 for(const q of [wallet,progress,daily,settings,packages,announcements,ledger,orders,tickets,purchases])if(q.error)throw q.error;
 return {profile:p,balance:wallet.data?.balance||0,progress:progress.data,daily:daily.data,
 settings:settings.data,packages:packages.data,announcements:announcements.data,
 ledger:ledger.data,orders:orders.data,tickets:tickets.data,purchases:purchases.data,admin:await isAdmin(p.id)};
}
async function userAction(p:any,b:any){
 switch(b.action){
 case "bootstrap":return await bootstrap(p);
 case "daily":return requireOk(await db.rpc("ss_claim_daily",{p_user:p.id}));
 case "start":{
  const stage=Number(b.stage);
  if(!Number.isInteger(stage)||stage<1||stage>200)fail("مرحله نامعتبر است.");
  if(stage>1){
   const prior=requireOk(await db.from("ss_progress").select("best_score,cleared").eq("user_id",p.id).eq("stage",stage-1).maybeSingle());
   if(!prior?.cleared||prior.best_score<75)fail("ابتدا مرحله قبل را با امتیاز ۷۵ یا بیشتر تمام کنید.");
  }
  const recent=requireOk(await db.from("ss_runs").select("id").eq("user_id",p.id)
   .is("finished_at",null).gt("started_at",new Date(Date.now()-120000).toISOString()).limit(3));
  if((recent?.length||0)>=3)fail("تعداد نبردهای هم‌زمان زیاد است؛ کمی بعد دوباره تلاش کنید.");
  const run=requireOk(await db.from("ss_runs").insert({user_id:p.id,stage}).select("id,started_at,stage").single());
  return {...run,enemies:8+Math.min(12,Math.floor(stage/10))};
 }
 case "finish":{
  const kills=Number(b.kills),score=Number(b.score),won=b.won===true;
  const hearts=Number(b.hearts),elapsed=Number(b.elapsed);
  if(!Number.isInteger(kills)||!Number.isInteger(score)||!Number.isInteger(hearts)
   ||!Number.isFinite(elapsed)||typeof b.run!=="string")fail("نتیجه نامعتبر است.");
  return requireOk(await db.rpc("ss_finish_verified_run",{p_user:p.id,p_run:b.run,p_kills:kills,
   p_score:score,p_won:won,p_hearts:hearts,p_elapsed:elapsed}));
 }
 case "buy":{
  if(!/^[a-f0-9-]{36}$/i.test(String(b.package_id)))fail("بسته نامعتبر است.");
  const coins=requireOk(await db.rpc("ss_buy_package",{p_user:p.id,p_package:b.package_id}));
  return {spent:coins};
 }
 case "link":{
  const code=crypto.randomUUID().replaceAll("-","").slice(0,12).toUpperCase();
  requireOk(await db.from("ss_link_codes").insert({code,user_id:p.id,expires_at:new Date(Date.now()+10*60000).toISOString()}));
  return {code,expires_minutes:10};
 }
 case "newTicket":{
  const subject=onlyString(b.subject,160),message=onlyString(b.message,8000);
  if(subject.length<3||message.length<4)fail("عنوان و شرح مشکل را کامل بنویسید.");
  const ticket=requireOk(await db.from("ss_tickets").insert({user_id:p.id,subject}).select("*").single());
  requireOk(await db.from("ss_ticket_messages").insert({ticket_id:ticket.id,author_id:p.id,message}));
  return ticket;
 }
 case "ticketMessages":{
  const ticket=requireOk(await db.from("ss_tickets").select("*").eq("id",String(b.ticket_id)).maybeSingle());
  if(!ticket||(ticket.user_id!==p.id&&!await isAdmin(p.id)))fail("دسترسی به تیکت ندارید.");
  const msgs=requireOk(await db.from("ss_ticket_messages").select("*").eq("ticket_id",ticket.id).order("created_at"));
  return {ticket,messages:msgs};
 }
 case "ticketUpload":{
  const t=requireOk(await db.from("ss_tickets").select("*").eq("id",String(b.ticket_id)).maybeSingle());
  if(!t||t.user_id!==p.id&&!await isAdmin(p.id))fail("دسترسی ندارید.");
  const bytes=Number(b.bytes);
  if(!Number.isSafeInteger(bytes)||bytes<1||bytes>t.file_limit)fail("حجم فایل از سقف مجاز این تیکت بیشتر است.");
  const path="ss/"+t.id+"/"+crypto.randomUUID()+"-"+onlyString(b.filename,70).replace(/[^a-zA-Z0-9._-]/g,"_");
  const signed=requireOk(await db.storage.from("ss-ticket-files").createSignedUploadUrl(path));
  if(!signed)fail("ساخت لینک بارگذاری ناموفق بود.");
   return {path,token:signed.token};
 }
 case "ticketFile":{
  const path=onlyString(b.path,500);
  const match=/^ss\/([a-f0-9-]{36})\/([a-zA-Z0-9._-]{1,120})$/i.exec(path);
  if(!match)fail("مسیر فایل نامعتبر است.");
  const t=requireOk(await db.from("ss_tickets").select("*").eq("id",match[1]).maybeSingle());
  if(!t||t.user_id!==p.id&&!await isAdmin(p.id))fail("دسترسی ندارید.");
  return requireOk(await db.storage.from("ss-ticket-files").createSignedUrl(path,300));
 }
 case "replyTicket":{
  const t=requireOk(await db.from("ss_tickets").select("*").eq("id",String(b.ticket_id)).maybeSingle());
  const admin=await isAdmin(p.id);
  if(!t||t.user_id!==p.id&&!admin)fail("تیکت یافت نشد.");
  if(["closed","closed_support"].includes(t.status)&&!admin)fail("این تیکت بسته شده است.");
  const message=onlyString(b.message,8000),path=onlyString(b.path,500);
  if(!message&&!path)fail("متن یا فایل لازم است.");
  if(path&&!path.startsWith("ss/"+t.id+"/"))fail("مسیر فایل نامعتبر است.");
  if(path){
   const file=path.split("/").pop()||"";
   const objects=requireOk(await db.storage.from("ss-ticket-files").list("ss/"+t.id,{search:file,limit:10}));
   if(!objects)fail("فهرست فایل‌ها دریافت نشد.");
    const uploaded=objects.find((x:any)=>x.name===file);
   const actual=Number(uploaded?.metadata?.size);
   if(!uploaded||!Number.isSafeInteger(actual)||actual<1||actual>t.file_limit)fail("فایل بارگذاری نشده یا از سقف تیکت بزرگ‌تر است.");
  }
  requireOk(await db.from("ss_ticket_messages").insert({ticket_id:t.id,author_id:p.id,message,attachment_path:path||null}));
  requireOk(await db.from("ss_tickets").update({status:admin?"awaiting_user":"review",updated_at:new Date().toISOString()}).eq("id",t.id));
  return {saved:true};
 }
 default:fail("عملیات ناشناخته است.");
 }
}
async function adminAction(p:any,b:any){
 if(!await isAdmin(p.id))fail("حساب شما دسترسی مدیریت ندارد.");
 switch(b.action){
 case "adminData":{
  const [users,wallets,packages,discounts,announcements,tickets,orders,settings,keys]=await Promise.all([
   db.from("ss_profiles").select("*").order("created_at",{ascending:false}).limit(500),
   db.from("ss_wallets").select("*").limit(500),
   db.from("ss_packages").select("*").order("created_at",{ascending:false}).limit(500),
   db.from("ss_discounts").select("*").limit(500),
   db.from("ss_announcements").select("*").order("created_at",{ascending:false}).limit(100),
   db.from("ss_tickets").select("*").order("updated_at",{ascending:false}).limit(500),
   db.from("ss_orders").select("*").order("created_at",{ascending:false}).limit(200),
   db.from("ss_settings").select("*").eq("id",true).single(),
   db.from("ss_private_config").select("name")
  ]);
  for(const q of [users,wallets,packages,discounts,announcements,tickets,orders,settings,keys])if(q.error)throw q.error;
  return {users:users.data,wallets:wallets.data,packages:packages.data,discounts:discounts.data,
  announcements:announcements.data,tickets:tickets.data,orders:orders.data,settings:settings.data,
  tokens:keys.data?.map((x:any)=>x.name)||[]};
 }
 case "adminUser":{
  const uid=String(b.id||"");const updates:any={};
  for(const field of ["first_name","last_name","phone","gender","disabled_reason"])if(b[field]!==undefined)updates[field]=onlyString(b[field],250);
  if(b.active!==undefined)updates.active=!!b.active;
  if(updates.phone&&!validPhone(updates.phone))fail("شماره موبایل باید ۱۱ رقمی باشد.");
  if(updates.gender&&!["زن","مرد"].includes(updates.gender))fail("جنسیت نامعتبر است.");
  if(updates.active===false&&!updates.disabled_reason)fail("علت غیرفعال‌سازی الزامی است.");
  if(b.username!==undefined){
   const username=onlyString(b.username,24).toLowerCase();
   if(!/^[a-z0-9_]{3,24}$/.test(username))fail("نام کاربری نامعتبر است.");
   updates.username=username;
  }
  if(uid===p.id&&updates.active===false)fail("مدیر نمی‌تواند حساب خود را غیرفعال کند.");
  const old=requireOk(await db.from("ss_profiles").select("username,phone").eq("id",uid).single());
  if(updates.phone&&updates.phone!==old?.phone){updates.bale_verified_at=null;updates.bale_user_id=null;}
   if(!old)fail("حساب یافت نشد.");
  const authUpdates:any={};
  if(updates.username&&updates.username!==old.username)authUpdates.email=emailFor(updates.username),authUpdates.email_confirm=true;
  if(b.password){if(String(b.password).length<10)fail("رمز حداقل ۱۰ کاراکتر باشد.");authUpdates.password=String(b.password);}
  if(Object.keys(authUpdates).length){const r=await db.auth.admin.updateUserById(uid,authUpdates);if(r.error)throw r.error;}
  try {requireOk(await db.from("ss_profiles").update(updates).eq("id",uid));}
  catch(e){if(authUpdates.email)await db.auth.admin.updateUserById(uid,{email:emailFor(old.username),email_confirm:true});throw e;}
  return {saved:true};
 }
 case "adminCoins":{
  const delta=Number(b.delta);if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>1e7)fail("تعداد سکه نامعتبر است.");
  requireOk(await db.rpc("ss_post_ledger",{p_user:String(b.id),p_delta:delta,p_reason:"admin_adjustment",p_ref:"admin:"+crypto.randomUUID()}));
  return {saved:true};
 }
 case "adminPackage":{
  const item:any={title:onlyString(b.title,90),description:onlyString(b.description,1000),coins:Number(b.coins),active:b.active!==false};
  if(!item.title||!Number.isSafeInteger(item.coins)||item.coins<=0)fail("مشخصات بسته نامعتبر است.");
  if(b.id)item.id=b.id;
  return requireOk(await db.from("ss_packages").upsert(item).select().single());
 }
 case "adminNotice":{
  const item:any={title:onlyString(b.title,160),body:onlyString(b.body,5000),active:b.active!==false};
  if(!item.title||!item.body)fail("اطلاعیه کامل نیست.");
  if(b.id)item.id=b.id;
  return requireOk(await db.from("ss_announcements").upsert(item).select().single());
 }
 case "adminDiscount":{
  const code=onlyString(b.code,32).toUpperCase(),kind=b.kind,value=Number(b.value);
  if(!/^[A-Z0-9_-]{3,32}$/.test(code)||!["percent","rial"].includes(kind)
   ||!Number.isSafeInteger(value)||value<1||value>2147483647)fail("کد یا مقدار تخفیف نامعتبر است.");
   if(kind==="percent"&&value>99)fail("تخفیف درصدی باید بین ۱ تا ۹۹ باشد؛ مثلاً برای ۵۰ درصد مقدار ۵۰ وارد کنید.");
  const unlimited=b.unlimited===true,dateUnlimited=b.date_unlimited===true;
  const maxUses=unlimited?null:Number(b.max_uses);
  if(maxUses!==null&&(!Number.isSafeInteger(maxUses)||maxUses<1||maxUses>2147483647))fail("سقف استفاده باید یک عدد مثبت باشد.");
  const parseISO=(input:unknown)=>{
   if(typeof input!=="string"||!(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).test(input)||!Number.isFinite(Date.parse(input)))fail("تاریخ اعتبار نامعتبر است.");
   return new Date(input).toISOString();
  };
  const fromDate=dateUnlimited?null:parseISO(b.valid_from);
  const untilDate=dateUnlimited?null:parseISO(b.valid_until);
  if(!dateUnlimited&&Date.parse(fromDate!)>=Date.parse(untilDate!))fail("پایان اعتبار باید بعد از شروع اعتبار باشد.");
  const previous=requireOk(await db.from("ss_discounts").select("used_count").eq("code",code).maybeSingle());
  if(maxUses!==null&&previous&&maxUses<previous.used_count)fail("سقف استفاده نباید کمتر از تعداد استفاده‌های ثبت‌شده باشد.");
  const item={kind,value,active:b.active!==false,unlimited,max_uses:maxUses,valid_from:fromDate,valid_until:untilDate};
  if(previous){
   let query=db.from("ss_discounts").update(item).eq("code",code);
   // Avoid lowering the limit below concurrent coupon reservations.
   if(maxUses!==null)query=query.lte("used_count",maxUses);
   const row=requireOk(await query.select().maybeSingle());
   if(!row)fail("سقف استفاده در اثر سفارش هم‌زمان تغییر کرد. دوباره تلاش کنید.");
   return row;
  }
  return requireOk(await db.from("ss_discounts").insert({code,...item}).select().single());
 }
 case "adminTicket":{
  const updates:any={updated_at:new Date().toISOString()};
  if(b.status){if(!["sent","review","awaiting_user","closed","closed_support"].includes(b.status))fail("وضعیت نامعتبر است.");updates.status=b.status;}
  if(b.file_limit!==undefined){const limit=Number(b.file_limit);if(!Number.isSafeInteger(limit)||limit<0||limit>52428800)fail("سقف فایل تا ۵۰ مگابایت است.");updates.file_limit=limit;}
  return requireOk(await db.from("ss_tickets").update(updates).eq("id",String(b.id)).select().single());
 }
 case "adminSettings":{
  const price=Number(b.price_rial_per_coin),url=onlyString(b.bale_url,300);
  if(!Number.isSafeInteger(price)||price<0||url&&!/^https:\/\/(ble\.ir|bale\.ai)\//.test(url))fail("تنظیمات نامعتبر است.");
  requireOk(await db.from("ss_settings").update({price_rial_per_coin:price,bale_url:url,updated_at:new Date().toISOString()}).eq("id",true));
  for(const name of ["bot_token","provider_token"]){const value=onlyString(b[name],250);if(value)requireOk(await db.from("ss_private_config").upsert({name,secret:value}));}
  let webhook="not_configured";
  const row=await db.from("ss_private_config").select("secret").eq("name","bot_token").maybeSingle();
  if(row.data?.secret){
   let s=await db.from("ss_private_config").select("secret").eq("name","webhook_secret").maybeSingle();
   if(!s.data){
    const secret=crypto.randomUUID()+crypto.randomUUID();
    requireOk(await db.from("ss_private_config").upsert({name:"webhook_secret",secret}));
    s={data:{secret}} as any;
   }
   const endpoint=URL+"/functions/v1/space-shooter-bale?secret="+encodeURIComponent(s.data!.secret);
   const r=await fetch("https://tapi.bale.ai/bot"+row.data.secret+"/setWebhook",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:endpoint})});
   const j=await r.json().catch(()=>({ok:false}));
   webhook=j.ok===true?"configured":"error";
  }
  return {saved:true,webhook};
 }
 default:fail("عملیات مدیریت ناشناخته است.");
 }
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=="POST")return json(req,{ok:false,error:"Method not allowed"},405);
 try{
  const b=await req.json();if(!b||typeof b.action!=="string")fail("درخواست نامعتبر");
  if(b.action==="register")return json(req,{ok:true,data:await registration(b,req)});
  const p=await currentUser(req);
  if(b.action==="bootstrap")return json(req,{ok:true,data:await bootstrap(p)});
  if(!p.active)fail("حساب غیرفعال است: "+(p.disabled_reason||"با پشتیبانی تماس بگیرید."));
  const data=b.action.startsWith("admin")?await adminAction(p,b):await userAction(p,b);
  return json(req,{ok:true,data});
 }catch(e){return json(req,{ok:false,error:e instanceof Error?e.message:"خطای ناشناخته"},400);}
});