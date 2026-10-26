import {createClient} from "https://esm.sh/@supabase/supabase-js@2.58.0?bundle";
// The game engine loads only when a player starts a mission.
import {jalaliMonths,jalaliToday,jalaliMonthGrid,parseJalaliDate,formatJalaliDate,jalaliFromISO,jalaliToISO,shiftJalaliMonth} from "./jalali-calendar.js";
const PROJECT="https://efibfevyiepkwpnobaro.supabase.co";
const PUBLIC_KEY="sb_publishable_zbEGYX6DGhjFRQf6FWiIWQ_IdYj84nW";
const client=createClient(PROJECT,PUBLIC_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const API=PROJECT+"/functions/v1/space-shooter-api";
const $=s=>document.querySelector(s);
const esc=value=>String(value??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const num=n=>Number(n||0).toLocaleString("fa-IR");
const normal=s=>String(s||"").replace(/[۰-۹]/g,c=>"۰۱۲۳۴۵۶۷۸۹".indexOf(c)).replace(/[٠-٩]/g,c=>"٠١٢٣٤٥٦٧٨٩".indexOf(c));
const states={sent:"ارسال شده",review:"در حال بررسی",awaiting_user:"در انتظار پاسخ شما",closed:"بسته شده",closed_support:"بسته شده توسط پشتیبانی"};
const navItems=[["home","⌂ خانه"],["levels","🚀 شروع بازی"],["shop","🛍 فروشگاه"],["daily","🎁 پاداش روزانه"],["support","🎫 پشتیبانی"],["buycoins","🪙 خرید سکه"],["ledger","📜 گردش سکه"],["orders","🧾 واریزی‌ها"]];
const state={session:null,data:null,view:"home",authTab:"login",chapter:1,adminTab:"users",adminData:null,
 currentTicket:null,ticketDetails:null,editingUser:null,editingPackage:null,editingDiscount:null,gameStop:null,gameRun:null,gameStage:null,gameStats:null};
let toastTimer;
function toast(message,error=false){const t=$("#toast");t.textContent=String(message);t.className="show"+(error?" error":"");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className="",5000);}
function dateFa(d){if(!d)return "—";const parts=new Intl.DateTimeFormat("fa-IR-u-ca-persian",{timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(d));const get=x=>parts.find(p=>p.type===x)?.value||"";return get("hour")+":"+get("minute")+"  "+get("day")+"/"+get("month")+"/"+get("year");}
function dayFa(d){return d?new Intl.DateTimeFormat("fa-IR-u-ca-persian",{timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(d)):"—";}
function formObj(form){const out=Object.fromEntries(new FormData(form).entries());for(const k in out)if(typeof out[k]==="string")out[k]=normal(out[k]).trim();return out;}

function closeDiscountCalendars(){
 document.querySelectorAll(".jalali-popup").forEach(p=>p.hidden=true);
}
function syncDiscountDateFields(form){
 const isUnlimited=form.elements.namedItem("date_unlimited").checked;
 for(const name of ["valid_from","valid_until","start_time","end_time"]){
  const input=form.elements.namedItem(name);
  input.disabled=isUnlimited;input.required=!isUnlimited;
 }
 if(isUnlimited)closeDiscountCalendars();
}
function syncDiscountValueField(form){
 const kind=form?.elements.namedItem("kind")?.value;
 const value=form?.elements.namedItem("value");
 if(!value)return;
 value.max=kind==="percent"?"100":"2147483647";
 const label=form.querySelector("#discount-value-hint");
 if(label)label.textContent=kind==="percent"
  ?"تخفیف درصدی از ۱ تا ۱۰۰ مجاز است؛ ۱۰۰٪ یعنی دریافت رایگان (یک‌بار برای هر حساب، حداکثر ۵۰۰ سکه)."
  :"مبلغ ثابت تخفیف را به ریال وارد کنید.";
}
function discountCalendarMarkup(pop){
 const year=Number(pop.dataset.year),month=Number(pop.dataset.month),field=pop.dataset.calendarFor;
 const selected=parseJalaliDate(document.querySelector('#admin-discount [name="'+field+'"]').value);
 const today=jalaliToday();
 const week=["ش","ی","د","س","چ","پ","ج"];
 return '<div class="calendar-heading"><button type="button" class="ghost small" data-action="calendar-month" data-step="-1" data-field="'+field+'" aria-label="ماه قبل">❮</button><strong>'+jalaliMonths[month-1]+' '+num(year)+'</strong><button type="button" class="ghost small" data-action="calendar-month" data-step="1" data-field="'+field+'" aria-label="ماه بعد">❯</button></div><div class="calendar-grid">'+
 week.map(w=>'<span class="weekday">'+w+'</span>').join("")+
 jalaliMonthGrid(year,month).map(day=>day===null?'<span class="calendar-empty"></span>':'<button type="button" class="calendar-day'+(selected?.year===year&&selected?.month===month&&selected?.day===day?" selected":"")+(today.year===year&&today.month===month&&today.day===day?" today":"")+'" data-action="calendar-day" data-field="'+field+'" data-day="'+day+'" aria-label="روز '+num(day)+'" aria-pressed="'+(selected?.year===year&&selected?.month===month&&selected?.day===day)+'">'+num(day)+'</button>').join("")+
 '</div><p class="hint">روز را از تقویم شمسی انتخاب کنید.</p>';
}
function openDiscountCalendar(field){
 if(!["valid_from","valid_until"].includes(field))return;
 const form=$("#admin-discount");if(!form||form.elements.namedItem("date_unlimited").checked)return;
 const pop=form.querySelector('[data-calendar-for="'+field+'"]'),input=form.elements.namedItem(field);
 if(!pop)return;
 const shouldOpen=pop.hidden;
 closeDiscountCalendars();
 if(!shouldOpen)return;
 const d=parseJalaliDate(input.value)||jalaliToday();
 pop.dataset.year=String(d.year);pop.dataset.month=String(d.month);
 pop.innerHTML=discountCalendarMarkup(pop);pop.hidden=false;
 pop.querySelector("button")?.focus();
}

function setPage(html){$("#app").innerHTML=html;$("#app").focus({preventScroll:true});}
async function call(action,payload={}){
 const token=state.session?.access_token;
 let res;
 try{res=await fetch(API,{method:"POST",headers:{"Content-Type":"application/json","apikey":PUBLIC_KEY,...(token?{"Authorization":"Bearer "+token}:{})},body:JSON.stringify({action,...payload})});}
 catch{throw Error("اتصال به سرور بازی برقرار نشد. انتشار Edge Function را بررسی کنید.");}
 const out=await res.json().catch(()=>({ok:false,error:"پاسخ نامعتبر از سرور"}));
 if(!res.ok||!out.ok)throw Error(out.error||"درخواست ناموفق بود.");
 return out.data;
}
async function init(){
 const {data:{session}}=await client.auth.getSession();state.session=session;
 if(session){await refresh(true);}else renderAuth();
 client.auth.onAuthStateChange((_event,s)=>{state.session=s;if(!s){state.data=null;state.adminData=null;if(state.gameStop)state.gameStop();state.gameStop=null;renderAuth();}});
 let walletRefreshInFlight=false;
 const updateWallet=async()=>{
  if(walletRefreshInFlight||!state.session||!state.data||state.view==="game"||document.hidden)return;
  walletRefreshInFlight=true;
  try{
   const data=await call("wallet");
   if(data&&state.data){state.data.balance=data.balance;const el=$("#coinbalance");if(el)el.textContent=num(data.balance);}
  }catch(e){console.warn("Wallet refresh deferred",e);}
  finally{walletRefreshInFlight=false;}
 };
 setInterval(updateWallet,30000);
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)updateWallet();});
}
async function refresh(claim=false){
 if(!state.session)return;
 try{
  if(claim){try{const r=await call("daily");const item=Array.isArray(r)?r[0]:r;if(item?.reward>0)toast("🎁 پاداش ورود امروز: "+num(item.reward)+" سکه");}catch(e){console.warn("Daily reward not claimed",e);}}
  state.data=await call("bootstrap");
  render();
 }catch(e){setPage('<div class="surface"><h2>خطا در اتصال به حساب</h2><p>'+esc(e.message)+'</p><button class="button" data-action="refresh">تلاش دوباره</button></div>');}
}
function chrome(){
 const logged=!!state.data&&!state.data.disabled;
 $("#coinbox").hidden=!logged||state.view==="game";
 $("#logout-btn").hidden=!state.session;
 $("#player-name").textContent=logged?"👤 "+state.data.profile.first_name+" "+state.data.profile.last_name:"";
 $("#coinbalance").textContent=num(state.data?.balance||0);
 const nav=$("#nav");nav.hidden=!logged||state.view==="game";
 nav.innerHTML=navItems.map(([id,title])=>'<button data-nav="'+id+'" class="'+(state.view===id?"active":"")+'">'+title+'</button>').join("")+(state.data?.admin?'<button data-nav="admin" class="'+(state.view==="admin"?"active":"")+'">⚙ مدیریت</button>':"");
 $("#notice-area").innerHTML=state.view!=="game"&&logged?(state.data.announcements||[]).map(n=>'<div class="notice"><b>📢 '+esc(n.title)+'</b><p>'+esc(n.body)+'</p></div>').join(""):"";
}
function navigate(to){if(state.gameStop&&state.view==="game"){state.gameStop();state.gameStop=null;state.gameRun=null;}state.view=to;window.scrollTo({top:0,behavior:"instant"});render();}
function render(){
 chrome();
 if(!state.session)return renderAuth();
 if(!state.data)return;
 if(state.data.disabled){setPage('<div class="surface"><h2>⛔ حساب کاربری غیرفعال است</h2><p>علت: '+esc(state.data.profile.disabled_reason||"توسط مدیریت")+'</p><button class="ghost" data-action="logout">خروج از حساب</button></div>');return;}
 switch(state.view){
  case "home":return renderHome();
  case "levels":return renderLevels();
  case "shop":return renderShop();
  case "daily":return renderDaily();
  case "support":return renderSupport();
  case "buycoins":return renderBuy();
  case "ledger":return renderLedger();
  case "orders":return renderOrders();
  case "admin":return renderAdmin();
  case "game":return;
  default:navigate("home");
 }
}
function renderAuth(){
 $("#nav").hidden=true;$("#coinbox").hidden=true;$("#logout-btn").hidden=!state.session;$("#player-name").textContent="";$("#notice-area").innerHTML="";
 const login=state.authTab==="login";
 setPage('<div class="auth-layout"><section><div class="eyebrow">ENTER THE GALAXY</div><h1>نبرد در <span class="gradient">بی‌نهایت</span></h1><p>۲۰ فصل، ۲۰۰ مرحله، دشمنان فضایی و رادار حرفه‌ای. سفینه‌ات را آماده کن و کهکشان را پس بگیر.</p><div class="stats"><div class="stat"><strong>۲۰۰</strong><span>مرحله</span></div><div class="stat"><strong>۲۰</strong><span>فصل</span></div><div class="stat"><strong>۵ ❤️</strong><span>جان در هر نبرد</span></div></div></section><section class="surface"><div class="auth-tabs"><button class="ghost '+(login?"selected":"")+'" data-action="auth-login">ورود</button><button class="ghost '+(!login?"selected":"")+'" data-action="auth-register">ثبت‌نام</button></div>'+
 (login?'<h2>بازگشت فرمانده 👋</h2><p>نام کاربری و رمز عبورت را وارد کن.</p><form id="login-form"><div class="field"><label>نام کاربری انگلیسی</label><input name="username" required autocomplete="username" pattern="[A-Za-z0-9_]{3,24}"></div><div class="field"><label>رمز عبور</label><input name="password" required type="password" autocomplete="current-password"></div><button type="submit" class="button">ورود به کهکشان</button></form>'
 :'<h2>عضویت در ناوگان</h2><form id="register-form"><div class="formgrid"><div class="field"><label>نام</label><input name="first_name" maxlength="70" required></div><div class="field"><label>نام خانوادگی</label><input name="last_name" maxlength="70" required></div><div class="field"><label>شماره موبایل ۱۱ رقمی</label><input name="phone" inputmode="numeric" pattern="09[0-9]{9}" maxlength="11" required></div><div class="field"><label>جنسیت</label><select name="gender" required><option value="">انتخاب کنید</option><option value="زن">زن</option><option value="مرد">مرد</option></select></div><div class="field"><label>نام کاربری انگلیسی</label><input name="username" pattern="[A-Za-z0-9_]{3,24}" minlength="3" maxlength="24" required></div><div class="field"><label>رمز عبور (حداقل ۱۰ کاراکتر)</label><input name="password" type="password" minlength="10" required></div><div class="field"><label>تکرار رمز عبور</label><input name="password2" type="password" minlength="10" required></div></div><button type="submit" class="button">ایجاد حساب</button></form><p class="hint">برای خرید امن سکه، شماره حساب باید در بازوی بله نیز تأیید و به حساب متصل شود.</p>')+
 '</section></div>');
}
function renderHome(){
 const completed=(state.data.progress||[]).filter(x=>x.cleared&&x.best_score>=75).length;
 const p=state.data.profile;
 setPage('<div class="hero"><div class="hero-copy"><div class="eyebrow">MISSION CONTROL · '+esc(p.username.toUpperCase())+'</div><h1>به <span class="gradient">کهکشان</span> خوش آمدی، '+esc(p.first_name)+'!</h1><p>سفینه دشمنان را نابود کن؛ برای هر دشمن ۱۰ سکه و در اولین پیروزی هر مرحله، برای هر امتیاز ۲ سکه دریافت می‌کنی.</p><div class="buttons"><button class="button" data-nav="levels">🚀 شروع بازی</button><button class="ghost" data-nav="shop">🛍 فروشگاه</button></div><div class="stats"><div class="stat"><strong>'+num(completed)+'/۲۰۰</strong><span>مراحل تکمیل‌شده</span></div><div class="stat"><strong>'+num(state.data.balance)+' 🪙</strong><span>موجودی سکه</span></div><div class="stat"><strong>۵ ❤️</strong><span>قلب در هر بازی</span></div></div></div><div class="hero-art"><div class="planet"></div><div class="ship">🚀</div><span class="mini-spark one">✦</span><span class="mini-spark two">✧</span></div></div>'+
 '<div class="section-head"><div><h2>مرکز فرماندهی</h2><p>همه قابلیت‌های بازی در یک نگاه</p></div></div><div class="cards">'+
 [["🚀","شروع بازی","۲۰۰ مرحله در ۲۰ فصل؛ امتیاز ۷۵ برای گشودن مرحله بعد","levels"],
 ["🛍","فروشگاه","دریافت بسته‌ها با سکه موجود در کیف پول","shop"],
 ["🎁","پاداش روزانه","روز اول ۱۰۰ سکه و هر روز متوالی ۱۰۰ سکه بیشتر","daily"],
 ["🎫","پشتیبانی","ثبت و پیگیری تیکت و ارسال فایل","support"],
 ["🪙","خرید سکه","خرید از طریق بازوی رسمی بله و تأیید پرداخت","buycoins"],
 ["📜","گردش سکه‌های من","ریز تمام دریافتی‌ها و برداشت‌ها","ledger"],
 ["🧾","واریزی‌های خرید سکه","مشاهده سفارش‌ها و وضعیت واریز","orders"]
 ].map(([icon,title,desc,nav])=>'<article class="card"><span class="emoji">'+icon+'</span><h3>'+title+'</h3><p>'+desc+'</p><button class="button small" data-nav="'+nav+'">مشاهده</button></article>').join("")+'</div>');
}
function unlocked(stage){if(stage===1)return true;const prior=(state.data.progress||[]).find(x=>x.stage===stage-1);return !!prior?.cleared&&prior.best_score>=75;}
function renderLevels(){
 const ch=state.chapter,base=(ch-1)*10;
 setPage('<div class="section-head"><div><div class="eyebrow">GALACTIC MISSIONS</div><h2>مراحل نبرد</h2><p>۲۰ فصل × ۱۰ مرحله | برای باز شدن هر مرحله، مرحله قبل باید با امتیاز حداقل ۷۵ تمام شود.</p></div><span class="chip">فصل '+num(ch)+' از ۲۰</span></div><div class="chapterbar">'+Array.from({length:20},(_,i)=>'<button class="ghost '+(ch===i+1?"selected":"")+'" data-action="chapter" data-id="'+(i+1)+'">فصل '+num(i+1)+'</button>').join("")+'</div><div class="surface"><div class="levels">'+Array.from({length:10},(_,i)=>{
  const n=base+i+1,p=(state.data.progress||[]).find(p=>p.stage===n),ok=unlocked(n);
  return '<button class="level '+(!ok?"locked":p?.cleared?"cleared":"")+'" data-action="start-level" data-id="'+n+'" '+(!ok?"disabled":"")+'><b>'+(ok?(p?.cleared?"★":"🚀"):"🔒")+' '+num(n)+'</b><span>'+(p?.cleared?"بهترین امتیاز: "+num(p.best_score):ok?"آماده نبرد":"قفل")+'</span></button>';
 }).join("")+'</div></div><p class="hint">هر بار بازی ۵ قلب داری. رادار گوشه صفحه جای دشمنان و سفینه را نشان می‌دهد. پاداش سکه فقط یک‌بار، در اولین پیروزی موفق هر مرحله، پرداخت می‌شود.</p>');
}
function renderShop(){
 setPage('<div class="section-head"><div><div class="eyebrow">IN-GAME STORE</div><h2>🛍 فروشگاه</h2><p>موجودی فعلی: '+num(state.data.balance)+' سکه</p></div><button class="button gold" data-nav="buycoins">+ خرید سکه</button></div>'+
 ((state.data.packages||[]).length?'<div class="cards">'+state.data.packages.map(p=>'<article class="card"><span class="emoji">📦</span><h3>'+esc(p.title)+'</h3><p>'+esc(p.description)+'</p><p><span class="chip">'+num(p.coins)+' 🪙</span></p><button class="button gold" data-action="buy-package" data-id="'+esc(p.id)+'" '+(state.data.balance<p.coins?"disabled":"")+'>'+(state.data.balance<p.coins?"سکه کافی نیست":"خرید بسته")+'</button></article>').join("")+'</div>':'<div class="surface empty">هنوز هیچ بسته‌ای توسط مدیر ثبت نشده است.</div>'));
}
function renderDaily(){
 const streak=state.data.daily?.streak||0;const claimed=state.data.daily?.claimed_on;
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tehran",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
 setPage('<div class="section-head"><div><div class="eyebrow">DAILY LOGIN BONUS</div><h2>🎁 پاداش روزانه</h2><p>با ورود در روزهای متوالی، پاداشت افزایش پیدا می‌کند.</p></div></div><div class="surface"><h3>🔥 زنجیره ورود: '+num(streak)+' روز</h3><p>روز اول ۱۰۰، روز دوم ۲۰۰، روز سوم ۳۰۰ سکه و به همین ترتیب. اگر یک روز وارد نشوی، زنجیره از اول شروع می‌شود.</p><div class="stats">'+Array.from({length:3},(_,i)=>'<div class="stat"><strong>'+num((i+1)*100)+' 🪙</strong><span>روز '+num(i+1)+'</span></div>').join("")+'</div><div class="buttons"><button class="button" data-action="daily">دریافت / بررسی پاداش امروز</button></div><p class="hint">آخرین دریافت: '+(claimed?esc(claimed):"هنوز پاداشی ثبت نشده")+'. پاداش ورود به‌طور خودکار هنگام ورود بررسی می‌شود.</p></div>');
}
function renderBuy(){
 const s=state.data.settings||{};
 setPage('<div class="section-head"><div><div class="eyebrow">BALE WALLET CHECKOUT</div><h2>🪙 خرید سکه از طریق بله</h2><p>هر سکه: '+(s.price_rial_per_coin?num(s.price_rial_per_coin)+" ریال":"هنوز قیمت‌گذاری نشده")+'</p></div></div><div class="two-col"><section class="surface"><h3>اتصال امن حساب به بازوی بله</h3><p>۱. داخل بازی کد اتصال بساز. ۲. وارد بازو شو و شماره خودت را با دکمه ارسال شماره به اشتراک بگذار. ۳. کد ۱۲ حرفی را در بازو بفرست تا مالکیت شماره تأیید شود. ۴. تعداد سکه، کد تخفیف و پرداخت را انجام بده.</p><div class="buttons"><button class="button" data-action="generate-link">🔐 ساخت کد اتصال (۱۰ دقیقه)</button></div><div id="link-result"></div><p class="hint">وضعیت تأیید شماره در بله: '+(state.data.profile.bale_verified_at?'✅ تأییدشده':'⚠️ هنوز تأیید نشده')+'. بدون شماره تأییدشده و کد اتصال معتبر، پرداخت مجاز نیست.</p></section><section class="surface"><h3>پرداخت با کیف پول بله</h3><p>سکه فقط پس از پیام پرداخت موفق و استعلام وضعیت پرداخت در بله واریز می‌شود.</p><div class="buttons"><button class="button gold" data-action="open-bale" '+(!s.bale_url?"disabled":"")+'>📲 ورود به بازو در بله</button></div>'+(s.bale_url?'<code>'+esc(s.bale_url)+'</code>':'<p class="hint">مدیر هنوز لینک بازوی بله را ثبت نکرده است.</p>')+'</section></div>');
}
function renderLedger(){
 const rows=state.data.ledger||[];
 setPage('<div class="section-head"><div><div class="eyebrow">WALLET HISTORY</div><h2>📜 گردش سکه‌های من</h2><p>تمام واریزها و برداشت‌ها با تاریخ و ساعت شمسی</p></div><button class="ghost" data-action="open-bale">ورود به بازو</button></div><div class="surface scroll"><table><thead><tr><th>زمان</th><th>شرح</th><th>نوع</th><th>تعداد سکه</th></tr></thead><tbody>'+
 (rows.length?rows.map(x=>'<tr><td>'+dateFa(x.created_at)+'</td><td>'+esc(reason(x.reason))+'</td><td>'+ (x.delta>0?"واریز":"برداشت")+'</td><td style="color:'+(x.delta>0?"#53e3ae":"#ff9aab")+'">'+(x.delta>0?"+":"−")+num(Math.abs(x.delta))+'</td></tr>').join(""):'<tr><td colspan="4" class="empty">تراکنشی وجود ندارد.</td></tr>')+'</tbody></table></div>');
}
function reason(key){return ({daily:"پاداش روزانه",first_clear:"اولین پیروزی مرحله",package:"خرید بسته فروشگاه",bale_purchase:"خرید سکه در بله",admin_adjustment:"اصلاح موجودی توسط مدیر"})[key]||key;}
function renderOrders(){
 const rows=state.data.orders||[];
 setPage('<div class="section-head"><div><div class="eyebrow">PAYMENT RECORDS</div><h2>🧾 واریزی‌ها برای خرید سکه</h2><p>آخرین سفارش‌های پرداخت در بله</p></div></div><div class="surface scroll"><table><thead><tr><th>شماره سفارش</th><th>تاریخ</th><th>مبلغ (ریال)</th><th>تعداد سکه</th><th>وضعیت</th></tr></thead><tbody>'+
 (rows.length?rows.map(x=>'<tr><td><code>'+esc(x.id)+'</code></td><td>'+dateFa(x.created_at)+'</td><td>'+num(x.amount_rial)+'</td><td>'+num(x.coins)+'</td><td><span class="tag '+(x.status==="paid"?"paid":"pending")+'">'+(x.status==="paid"?"واریز شده":x.status==="failed"?"عدم خریداری":x.precheckout_tx?"در حال بررسی پرداخت":"در انتظار آغاز پرداخت")+'</span></td></tr>').join(""):'<tr><td colspan="5" class="empty">سفارشی ثبت نشده است.</td></tr>')+'</tbody></table></div>');
}
function renderSupport(){
 const tickets=state.data.tickets||[];
 if(state.currentTicket&&state.ticketDetails)return renderTicket();
 setPage('<div class="section-head"><div><div class="eyebrow">MISSION SUPPORT</div><h2>🎫 پشتیبانی</h2><p>ثبت تیکت با امکان بارگذاری فایل تا ۳۰ مگابایت، یا سقف ویژه تعیین‌شده توسط مدیر</p></div></div><div class="two-col"><section class="surface"><h3>ثبت تیکت جدید</h3><form id="new-ticket"><div class="field"><label>عنوان موضوع</label><input name="subject" maxlength="160" required></div><div class="field"><label>شرح مشکل</label><textarea name="message" required></textarea></div><div class="field"><label>فایل پیوست اختیاری (تا ۳۰ مگابایت)</label><input type="file" name="attachment"></div><button class="button" type="submit">ارسال تیکت</button></form></section><section class="surface"><h3>تیکت‌های من</h3>'+
 (tickets.length?tickets.map(t=>'<div class="ticket-message"><b>'+esc(t.subject)+'</b><p><span class="tag">'+esc(states[t.status]||t.status)+'</span> • '+dateFa(t.updated_at)+'</p><button class="ghost small" data-action="open-ticket" data-id="'+t.id+'">مشاهده و پاسخ</button></div>').join(""):'<div class="empty">تیکتی ثبت نشده است.</div>')+'</section></div>');
}
function renderTicket(){
 const t=state.ticketDetails.ticket,m=state.ticketDetails.messages,admin=!!state.data.admin;
 setPage('<div class="section-head"><div><h2>🎫 '+esc(t.subject)+'</h2><p>شماره تیکت: <code>'+esc(t.id)+'</code> · '+esc(states[t.status]||t.status)+'</p></div><button class="ghost" data-action="back-tickets">بازگشت</button></div><section class="surface"><h3>گفتگو با پشتیبانی</h3>'+
 (m.length?m.map(x=>'<div class="ticket-message '+(x.author_id===state.data.profile.id?"owner":"")+'"><div class="hint">'+dateFa(x.created_at)+'</div><div>'+esc(x.message)+'</div>'+(x.attachment_path?'<button class="ghost small" data-action="ticket-file" data-path="'+esc(x.attachment_path)+'">📎 دانلود فایل</button>':"")+'</div>').join(""):'<p>هنوز پیامی ثبت نشده است.</p>')+
 (["closed","closed_support"].includes(t.status)&&!admin?'<p>تیکت بسته شده است.</p>':'<hr><form id="reply-ticket"><div class="field"><label>پاسخ</label><textarea name="message" placeholder="پاسخ خود را بنویسید"></textarea></div><div class="field"><label>فایل پیوست (سقف '+num(Math.floor(t.file_limit/1048576))+' مگابایت)</label><input type="file" name="attachment"></div><button class="button" type="submit">ارسال پاسخ</button></form>')+
 (admin?'<hr><h3>ابزار مدیر تیکت</h3><form id="admin-ticket"><input type="hidden" name="id" value="'+esc(t.id)+'"><div class="formgrid"><div class="field"><label>وضعیت</label><select name="status">'+Object.entries(states).map(([key,label])=>'<option value="'+key+'" '+(t.status===key?"selected":"")+'>'+label+'</option>').join("")+'</select></div><div class="field"><label>حداکثر پیوست (مگابایت؛ حداکثر ۵۰)</label><input type="number" name="file_mb" min="0" max="50" value="'+Math.floor(t.file_limit/1048576)+'"></div></div><button class="button small" type="submit">ثبت تغییرات</button></form>':"")+'</section>');
}
async function openTicket(id){
 const admin=state.data.admin;state.currentTicket=id;
 try{state.ticketDetails=await call("ticketMessages",{ticket_id:id});renderTicket();}
 catch(e){state.currentTicket=null;state.ticketDetails=null;toast(e.message,true);}
}
async function uploadAttachment(ticketId,file){
 if(!file||!file.size)return null;
 const upload=await call("ticketUpload",{ticket_id:ticketId,bytes:file.size,filename:file.name});
 const {error}=await client.storage.from("ss-ticket-files").uploadToSignedUrl(upload.path,upload.token,file,{contentType:file.type||"application/octet-stream"});
 if(error)throw Error(error.message);
 return upload.path;
}
function renderAdmin(){
 if(!state.adminData){setPage('<div class="loading"><div class="orbit"></div><h3>بارگذاری پنل مدیریت…</h3></div>');call("adminData").then(x=>{state.adminData=x;renderAdmin();}).catch(e=>setPage('<div class="surface">خطای پنل: '+esc(e.message)+'</div>'));return;}
 const t=state.adminTab,a=state.adminData;
 const tabs=[["users","کاربران"],["packages","بسته‌ها"],["discounts","تخفیف‌ها"],["notices","اطلاعیه‌ها"],["tickets","تیکت‌ها"],["orders","سفارش‌ها"],["settings","تنظیمات و توکن‌ها"]];
 let body="";
 if(t==="users"){
  if(state.editingUser){
   const u=a.users.find(x=>x.id===state.editingUser),w=a.wallets.find(x=>x.user_id===u?.id);
   body='<section class="surface"><h3>ویرایش کاربر: '+esc(u.username)+'</h3><p>موجودی: '+num(w?.balance)+' سکه</p><form id="admin-user"><input type="hidden" name="id" value="'+esc(u.id)+'"><div class="formgrid">'+
   [["نام","first_name",u.first_name],["نام خانوادگی","last_name",u.last_name],["نام کاربری","username",u.username],["شماره موبایل","phone",u.phone]].map(([label,name,value])=>'<div class="field"><label>'+label+'</label><input name="'+name+'" value="'+esc(value)+'" required></div>').join("")+
   '<div class="field"><label>جنسیت</label><select name="gender"><option value="زن" '+(u.gender==="زن"?"selected":"")+'>زن</option><option value="مرد" '+(u.gender==="مرد"?"selected":"")+'>مرد</option></select></div><div class="field"><label>وضعیت حساب</label><select name="active"><option value="true" '+(u.active?"selected":"")+'>فعال</option><option value="false" '+(!u.active?"selected":"")+'>غیرفعال</option></select></div><div class="field"><label>علت غیرفعال‌سازی</label><input name="disabled_reason" value="'+esc(u.disabled_reason||"")+'"></div><div class="field"><label>رمز جدید (اختیاری، حداقل ۱۰ کاراکتر)</label><input type="password" name="password" autocomplete="new-password"></div></div><button class="button" type="submit">ذخیره تغییرات</button> <button class="ghost" type="button" data-action="cancel-edit-user">بازگشت</button></form><hr><form id="admin-coins"><input name="id" type="hidden" value="'+esc(u.id)+'"><div class="field"><label>اصلاح موجودی (مثلاً ۱۰۰ یا ۱۰۰-)</label><input name="delta" type="number" step="1" required></div><button class="button small gold" type="submit">ثبت گردش سکه</button></form></section>';
  }else{
   body='<div class="surface scroll"><table><thead><tr><th>نام</th><th>نام کاربری</th><th>موبایل</th><th>جنسیت</th><th>سکه</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>'+a.users.map(u=>'<tr><td>'+esc(u.first_name)+" "+esc(u.last_name)+'</td><td>'+esc(u.username)+'</td><td>'+esc(u.phone)+'</td><td>'+esc(u.gender)+'</td><td>'+num(a.wallets.find(w=>w.user_id===u.id)?.balance)+'</td><td><span class="tag '+(u.active?"paid":"pending")+'">'+(u.active?"فعال":"غیرفعال")+'</span></td><td><button class="ghost small" data-action="edit-user" data-id="'+u.id+'">ویرایش</button></td></tr>').join("")+'</tbody></table></div>';
  }
 }
 if(t==="packages"){
  const p=a.packages.find(x=>x.id===state.editingPackage);
  body='<div class="two-col"><section class="surface"><h3>ثبت / ویرایش بسته</h3><form id="admin-package">'+(p?'<input name="id" type="hidden" value="'+esc(p.id)+'">':"")+'<div class="field"><label>نام بسته</label><input name="title" value="'+esc(p?.title||"")+'" required></div><div class="field"><label>توضیحات</label><textarea name="description">'+esc(p?.description||"")+'</textarea></div><div class="field"><label>هزینه سکه</label><input name="coins" type="number" min="1" value="'+esc(p?.coins||"")+'" required></div><div class="field"><label><input name="active" type="checkbox" '+(p?.active!==false?"checked":"")+'> فعال باشد</label></div><button type="submit" class="button">ذخیره بسته</button> <button type="button" class="ghost" data-action="new-package">بسته جدید</button></form></section><section class="surface"><h3>بسته‌های ثبت‌شده</h3>'+a.packages.map(x=>'<div class="ticket-message"><b>'+esc(x.title)+'</b> · '+num(x.coins)+' سکه · '+(x.active?"فعال":"غیرفعال")+' <button class="ghost small" data-action="edit-package" data-id="'+x.id+'">ویرایش</button></div>').join("")+'</section></div>';
 }
 if(t==="discounts"){
  const d=a.discounts.find(x=>x.code===state.editingDiscount);
  const start=jalaliFromISO(d?.valid_from),end=jalaliFromISO(d?.valid_until);
  const noDates=!d||(!d.valid_from&&!d.valid_until);
  const dateField=(field,label,value,timeName,timeValue)=>
   '<div class="field calendar-field"><label for="discount-'+field+'">'+label+'</label><div class="calendar-input-row"><input id="discount-'+field+'" name="'+field+'" value="'+esc(value)+'" placeholder="انتخاب از تقویم شمسی" readonly data-action="calendar-open" data-field="'+field+'"><button type="button" class="ghost calendar-open" data-action="calendar-open" data-field="'+field+'" aria-label="باز کردن تقویم '+label+'">📅 تقویم</button></div><div class="jalali-popup" data-calendar-for="'+field+'" role="dialog" aria-label="تقویم '+label+'" hidden></div></div><div class="field"><label for="discount-'+timeName+'">ساعت '+label+'</label><input id="discount-'+timeName+'" type="time" name="'+timeName+'" value="'+esc(timeValue)+'" required></div>';
  body='<div class="two-col"><section class="surface"><h3>'+(d?"ویرایش کد تخفیف":"ثبت کد تخفیف")+'</h3><form id="admin-discount"><div class="field"><label>کد انگلیسی</label><input name="code" pattern="[A-Za-z0-9_-]{3,32}" value="'+esc(d?.code||"")+'" '+(d?"readonly":"required")+'></div><div class="field"><label>نوع تخفیف</label><select name="kind"><option value="percent" '+(d?.kind==="percent"?"selected":"")+'>درصد</option><option value="rial" '+(d?.kind==="rial"?"selected":"")+'>مبلغ به ریال</option></select></div><div class="field"><label>میزان تخفیف</label><input name="value" type="number" min="1" max="'+(d?.kind==="rial"?"2147483647":"100")+'" value="'+esc(d?.value||"")+'" required><p class="hint" id="discount-value-hint" aria-live="polite">تخفیف درصدی باید بین ۱ تا ۹۹ باشد؛ برای کد GALAXY50 مقدار ۵۰ را وارد کنید.</p></div>'+
   '<div class="field"><label><input type="checkbox" name="date_unlimited" '+(noDates?"checked":"")+'> بدون محدودیت زمانی (تاریخ نامحدود)</label></div><div class="formgrid">'+
   dateField("valid_from","شروع اعتبار",start.date,"start_time",start.time||"00:00")+
   dateField("valid_until","پایان اعتبار",end.date,"end_time",end.time||"23:59")+
   '</div><div class="field"><label>سقف تعداد استفاده</label><input name="max_uses" type="number" min="1" value="'+esc(d?.max_uses||1)+'"></div><div class="field"><label><input name="unlimited" type="checkbox" '+(d?.unlimited?"checked":"")+'> بدون محدودیت تعداد استفاده</label></div><div class="field"><label><input name="active" type="checkbox" '+(d?.active!==false?"checked":"")+'> فعال باشد</label></div><button class="button" type="submit">'+(d?"ذخیره تغییرات":"ثبت کد")+'</button> <button type="button" class="ghost" data-action="new-discount">کد جدید</button></form></section>'+
   '<section class="surface"><h3>کدهای موجود</h3>'+a.discounts.map(x=>'<div class="ticket-message"><b>'+esc(x.code)+'</b><p>'+num(x.value)+(x.kind==="percent"?"٪":" ریال")+' · استفاده: '+num(x.used_count)+' · '+(x.unlimited?"تعداد استفاده نامحدود":"حداکثر "+num(x.max_uses))+'</p><p class="hint">'+(x.valid_from||x.valid_until?dayFa(x.valid_from)+' تا '+dayFa(x.valid_until):"اعتبار زمانی نامحدود")+' · '+(x.active?"فعال":"غیرفعال")+'</p><button type="button" class="ghost small" data-action="edit-discount" data-id="'+esc(x.code)+'">ویرایش</button></div>').join("")+'</section></div>';
 }
 if(t==="notices"){
  body='<div class="two-col"><section class="surface"><h3>اطلاعیه جدید</h3><form id="admin-notice"><div class="field"><label>موضوع</label><input name="title" required></div><div class="field"><label>شرح اطلاعیه</label><textarea name="body" required></textarea></div><button class="button" type="submit">انتشار اطلاعیه</button></form></section><section class="surface"><h3>اطلاعیه‌ها</h3>'+a.announcements.map(x=>'<div class="ticket-message"><b>'+esc(x.title)+'</b><p>'+esc(x.body)+'</p><small>'+dateFa(x.created_at)+'</small></div>').join("")+'</section></div>';
 }
 if(t==="tickets")body='<div class="surface"><h3>تیکت‌های کاربران</h3>'+a.tickets.map(x=>'<div class="ticket-message"><b>'+esc(x.subject)+'</b><p>کاربر: '+esc(a.users.find(u=>u.id===x.user_id)?.username||"—")+' · '+esc(states[x.status]||x.status)+' · '+dateFa(x.updated_at)+'</p><button class="ghost small" data-action="open-ticket" data-id="'+x.id+'">بررسی و پاسخ</button></div>').join("")+'</div>';
 if(t==="orders")body='<div class="surface scroll"><table><thead><tr><th>شماره سفارش</th><th>کاربر</th><th>زمان</th><th>تعداد</th><th>مبلغ ریال</th><th>وضعیت</th></tr></thead><tbody>'+a.orders.map(x=>'<tr><td><code>'+esc(x.id)+'</code></td><td>'+esc(a.users.find(u=>u.id===x.user_id)?.username||"—")+'</td><td>'+dateFa(x.created_at)+'</td><td>'+num(x.coins)+'</td><td>'+num(x.amount_rial)+'</td><td>'+esc(x.status==="pending"?(x.precheckout_tx?"در صف استعلام دوره‌ای":(Date.now()-Date.parse(x.created_at)>86400000?"⚠️ معلق بیش از ۲۴ ساعت؛ بررسی دستی":"در انتظار شروع پرداخت")):x.status)+'</td></tr>').join("")+'</tbody></table></div>';
 if(t==="settings")body='<section class="surface"><h3>تنظیمات بازو و قیمت سکه</h3><p>توکن‌ها فقط برای سرور ارسال می‌شوند و به مرورگر کاربران برنمی‌گردند. در کادر توکن خالی بگذارید تا مقدار قبلی حفظ شود.</p><form id="admin-settings"><div class="formgrid"><div class="field"><label>قیمت هر سکه (ریال؛ صفر یعنی فروش متوقف)</label><input name="price_rial_per_coin" type="number" min="0" value="'+esc(a.settings.price_rial_per_coin)+'" required></div><div class="field"><label>لینک رسمی بازوی بله (https://ble.ir/...)</label><input name="bale_url" type="url" value="'+esc(a.settings.bale_url)+'"></div><div class="field"><label>توکن بازوی بله '+(a.tokens.includes("bot_token")?"✅ ثبت شده":"⚠️ تنظیم نشده")+'</label><input name="bot_token" type="password" autocomplete="off"></div><div class="field"><label>توکن کیف پول بله '+(a.tokens.includes("provider_token")?"✅ ثبت شده":"⚠️ تنظیم نشده")+'</label><input name="provider_token" type="password" autocomplete="off"></div></div><button class="button" type="submit">ذخیره و تنظیم Webhook</button></form><p class="hint">قبل از تنظیم توکن، هر دو تابع Edge باید منتشر شده باشند.</p></section>';
 setPage('<div class="section-head"><div><div class="eyebrow">ADMIN COMMAND CENTER</div><h2>⚙ پنل مدیریت</h2><p>کاربران: '+num(a.users.length)+' · تیکت‌ها: '+num(a.tickets.length)+' · سفارش‌ها: '+num(a.orders.length)+'</p></div><button class="ghost small" data-action="admin-refresh">↻ بروزرسانی</button></div><div class="admin-nav">'+tabs.map(([key,title])=>'<button class="ghost '+(t===key?"selected":"")+'" data-action="admin-tab" data-id="'+key+'">'+title+'</button>').join("")+'</div>'+body);
 if(t==="discounts"){syncDiscountDateFields($("#admin-discount"));syncDiscountValueField($("#admin-discount"));}
}
async function startLevel(stage){
 try{
  const run=await call("start",{stage});state.gameRun=run;state.gameStage=stage;state.view="game";
  chrome();
  setPage('<div class="game-wrap"><div class="game-head"><div><span class="eyebrow">SPACE BATTLE</span><h2>نبرد مرحله '+num(stage)+'</h2></div><div class="game-metrics"><span class="metric" id="hearts">❤️❤️❤️❤️❤️</span><span class="metric" id="kills">دشمن: ۰ / '+num(run.enemies)+'</span><button class="ghost small" data-action="leave-game">خروج از نبرد</button></div></div><canvas id="battle" width="900" height="540" aria-label="زمین نبرد"></canvas><p class="game-instructions">🕹 با موس، لمس صفحه یا کلیدهای جهت‌نما و WASD حرکت کن. شلیک خودکار است. با P بازی را متوقف کن. رادار بالا-چپ در نمای روی صفحه انگلیسی سمت راست قرار دارد.</p></div>');
  const {startShooter}=await import("./game.js");
  state.gameStop=startShooter($("#battle"),{stage,count:run.enemies,onProgress:o=>{$("#hearts").textContent="❤️".repeat(o.hearts)+"🖤".repeat(5-o.hearts);$("#kills").textContent="دشمن: "+num(o.kills)+" / "+num(run.enemies);},onEnd:async result=>{
   state.gameStop=null;
   setPage('<div class="loading"><div class="orbit"></div><h2>در حال ثبت نتیجه نبرد…</h2></div>');
   try{
    const r=await call("finish",{run:run.id,...result});const outcome=Array.isArray(r)?r[0]:r;
    await refresh(false);state.view="result";chrome();
    setPage('<div class="surface" style="max-width:630px;margin:45px auto;text-align:center"><div style="font-size:60px">'+(result.won?"🏆":"💥")+'</div><h2>'+(result.won?"نبرد تمام شد!":"سفینه نابود شد")+'</h2><p>مرحله '+num(stage)+' · امتیاز '+num(result.score)+' / ۱۰۰ · دشمنان نابودشده: '+num(result.kills)+'</p><h3>سکه دریافتی: <span style="color:#ffdc83">'+num(outcome?.reward||0)+'</span> 🪙</h3><p>'+(outcome?.unlocked?"مرحله بعدی باز شد!":result.won?"برای باز شدن مرحله بعد باید امتیاز ۷۵ یا بیشتر کسب کنی.":"این بار سکه‌ای دریافت نمی‌شود.")+'</p><div class="buttons" style="justify-content:center"><button class="button" data-nav="levels">مراحل بازی</button><button class="ghost" data-action="retry-level" data-id="'+stage+'">تلاش دوباره</button></div></div>');
   }catch(e){state.view="result";chrome();setPage('<div class="surface"><h2>ثبت نتیجه ناموفق بود</h2><p>'+esc(e.message)+'</p><button class="button" data-nav="levels">بازگشت</button></div>');}
  }});
 }catch(e){toast(e.message,true);}
}
async function mutate(action,payload,success="ثبت شد"){
 const r=await call(action,payload);toast(success);
 if(state.adminData&&state.view==="admin"){state.adminData=await call("adminData");renderAdmin();}
 else await refresh(false);
 return r;
}
document.addEventListener("click",async e=>{
 if(!e.target.closest(".calendar-field"))closeDiscountCalendars();
 const el=e.target.closest("[data-nav],[data-action],#logout-btn,#coinplus");if(!el)return;
 if(el.id==="logout-btn"||el.dataset.action==="logout"){await client.auth.signOut();return;}
 if(el.id==="coinplus"){navigate("buycoins");return;}
 if(el.dataset.nav){navigate(el.dataset.nav);return;}
 const action=el.dataset.action,id=el.dataset.id;
 try{
  if(action==="auth-login"||action==="auth-register"){state.authTab=action==="auth-login"?"login":"register";renderAuth();}
  if(action==="refresh")await refresh(false);
  if(action==="refresh-startup")window.location.reload();
  if(action==="chapter"){state.chapter=Number(id);renderLevels();}
  if(action==="start-level")await startLevel(Number(id));
  if(action==="retry-level")await startLevel(Number(id));
  if(action==="leave-game"){if(confirm("نبرد را بدون پاداش ترک می‌کنی؟"))navigate("levels");}
  if(action==="buy-package"){const p=state.data.packages.find(p=>p.id===id);if(p&&confirm("خرید «"+p.title+"» با "+num(p.coins)+" سکه تأیید می‌شود؟"))await mutate("buy",{package_id:id},"بسته خریداری شد.");}
  if(action==="daily"){const r=await call("daily");const d=Array.isArray(r)?r[0]:r;toast(d?.reward?"پاداش "+num(d.reward)+" سکه دریافت شد.":"پاداش امروز قبلاً دریافت شده است.");await refresh(false);}
  if(action==="generate-link"){const r=await call("link");$("#link-result").innerHTML='<div class="notice">کد اتصال: <code>'+esc(r.code)+'</code> <button class="ghost small" data-action="copy-code" data-code="'+esc(r.code)+'">رونوشت</button></div>';}
  if(action==="copy-code"){await navigator.clipboard.writeText(el.dataset.code);toast("کد کپی شد.");}
  if(action==="open-bale"){const url=state.data.settings?.bale_url;if(url&&/^https:\/\/(ble\.ir|bale\.ai)\//.test(url))window.open(url,"_blank","noopener,noreferrer");else toast("لینک بازوی بله هنوز ثبت نشده است.",true);}
  if(action==="open-ticket")await openTicket(id);
  if(action==="back-tickets"){state.currentTicket=null;state.ticketDetails=null;navigate(state.data.admin?"admin":"support");}
  if(action==="ticket-file"){const d=await call("ticketFile",{path:el.dataset.path});if(d?.signedUrl)window.open(d.signedUrl,"_blank","noopener,noreferrer");}
  if(action==="admin-tab"){state.adminTab=id;state.editingUser=null;state.editingPackage=null;state.editingDiscount=null;renderAdmin();}
  if(action==="edit-discount"){state.editingDiscount=id;renderAdmin();}
  if(action==="new-discount"){state.editingDiscount=null;renderAdmin();}
  if(action==="calendar-open"){openDiscountCalendar(el.dataset.field);}
  if(action==="calendar-month"){
   const pop=$("#admin-discount")?.querySelector('[data-calendar-for="'+el.dataset.field+'"]');if(pop){const moved=shiftJalaliMonth(Number(pop.dataset.year),Number(pop.dataset.month),Number(el.dataset.step));if(moved.year>=1300&&moved.year<=1599){pop.dataset.year=String(moved.year);pop.dataset.month=String(moved.month);pop.innerHTML=discountCalendarMarkup(pop);}}
  }
  if(action==="calendar-day"){
   const form=$("#admin-discount"),pop=form?.querySelector('[data-calendar-for="'+el.dataset.field+'"]');if(pop){form.elements.namedItem(el.dataset.field).value=formatJalaliDate(Number(pop.dataset.year),Number(pop.dataset.month),Number(el.dataset.day));closeDiscountCalendars();}
  }
  if(action==="admin-refresh"){state.adminData=await call("adminData");renderAdmin();}
  if(action==="edit-user"){state.editingUser=id;renderAdmin();}
  if(action==="cancel-edit-user"){state.editingUser=null;renderAdmin();}
  if(action==="edit-package"){state.editingPackage=id;renderAdmin();}
  if(action==="new-package"){state.editingPackage=null;renderAdmin();}
 }catch(err){toast(err.message,true);}
});
document.addEventListener("submit",async e=>{
 const form=e.target;if(!(form instanceof HTMLFormElement))return;
 e.preventDefault();const id=form.id,b=formObj(form),button=form.querySelector('button[type="submit"]');
 if(button)button.disabled=true;
 try{
  if(id==="login-form"){
   const name=String(b.username||"").toLowerCase();
   if(!/^[a-z0-9_]{3,24}$/.test(name))throw Error("نام کاربری نامعتبر است.");
   const {data,error}=await client.auth.signInWithPassword({email:"ss-"+name+"@spaceshooter.invalid",password:b.password});
   if(error)throw Error("نام کاربری یا رمز عبور اشتباه است.");
   state.session=data.session;state.view="home";await refresh(true);
  }
  if(id==="register-form"){
   if(b.password!==b.password2)throw Error("رمز عبور و تکرار آن یکسان نیست.");
   await call("register",{...b,username:String(b.username).toLowerCase()});
   toast("حساب ایجاد شد. اکنون وارد شوید.");state.authTab="login";renderAuth();
  }
  if(id==="new-ticket"){
   const t=await call("newTicket",{subject:b.subject,message:b.message});
   const file=form.querySelector('[name="attachment"]').files?.[0];
   if(file){const path=await uploadAttachment(t.id,file);await call("replyTicket",{ticket_id:t.id,path,message:""});}
   toast("تیکت ثبت شد.");await refresh(false);
  }
  if(id==="reply-ticket"){
   const file=form.querySelector('[name="attachment"]').files?.[0];
   const path=file?await uploadAttachment(state.currentTicket,file):null;
   await call("replyTicket",{ticket_id:state.currentTicket,message:b.message,path});
   toast("پاسخ ارسال شد.");state.ticketDetails=await call("ticketMessages",{ticket_id:state.currentTicket});renderTicket();
  }
  if(id==="admin-ticket"){await mutate("adminTicket",{id:b.id,status:b.status,file_limit:Number(b.file_mb)*1048576});state.ticketDetails=await call("ticketMessages",{ticket_id:state.currentTicket});renderTicket();}
  if(id==="admin-user"){await mutate("adminUser",{...b,active:b.active==="true",password:b.password||undefined});state.editingUser=null;renderAdmin();}
  if(id==="admin-coins"){await mutate("adminCoins",{id:b.id,delta:Number(b.delta)});}
  if(id==="admin-package"){await mutate("adminPackage",{...b,coins:Number(b.coins),active:!!form.elements.namedItem("active").checked});state.editingPackage=null;renderAdmin();}
  if(id==="admin-discount"){
   if(b.kind==="percent"&&Number(b.value)>100)throw Error("درصد تخفیف حداکثر ۱۰۰ است.");
   const date_unlimited=form.elements.namedItem("date_unlimited").checked;
   const from=date_unlimited?null:jalaliToISO(b.valid_from,b.start_time);
   const until=date_unlimited?null:jalaliToISO(b.valid_until,b.end_time,true);
   if(!date_unlimited&&Date.parse(from)>Date.parse(until))throw Error("پایان اعتبار نباید قبل از شروع اعتبار باشد.");
   await mutate("adminDiscount",{code:b.code,kind:b.kind,value:Number(b.value),unlimited:form.elements.namedItem("unlimited").checked,date_unlimited,active:form.elements.namedItem("active").checked,max_uses:Number(b.max_uses||1),valid_from:from,valid_until:until});
   state.editingDiscount=null;renderAdmin();
  }
  if(id==="admin-notice"){await mutate("adminNotice",{title:b.title,body:b.body});}
  if(id==="admin-settings"){const r=await mutate("adminSettings",{price_rial_per_coin:Number(b.price_rial_per_coin),bale_url:b.bale_url,bot_token:b.bot_token,provider_token:b.provider_token});toast("تنظیمات ثبت شد. وضعیت وب‌هوک: "+esc(r.webhook));}
 }catch(err){toast(err.message,true);}
 finally{if(button&&button.isConnected)button.disabled=false;}
});
document.addEventListener("change",e=>{if(e.target.matches("#admin-discount [name=date_unlimited]"))syncDiscountDateFields(e.target.form);if(e.target.matches("#admin-discount [name=kind]"))syncDiscountValueField(e.target.form);});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDiscountCalendars();});
init().catch(error => {
 console.error("Space Shooter startup error",error);
 const app=$("#app");
 if(app)app.innerHTML='<section class="surface" style="max-width:650px;margin:45px auto;text-align:center"><h2>بارگذاری حساب ناموفق بود</h2><p>ارتباط با سرویس حساب برقرار نشد. اتصال اینترنت را بررسی کنید و صفحه را دوباره بارگذاری کنید.</p><button class="button" data-action="refresh-startup">تلاش دوباره</button></section>';
});