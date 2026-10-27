import {PILOTS,DRONES,mission} from './game-core.js';
import {watchAccount,openCoopTransport} from './realtime.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function createGalaxyUI({state,client,$,esc,num,toast,call,refresh,navigate,setPage,chrome,render,dateFa}){
 let stopWatch=null,heartbeatTimer=null,syncTimer=null,fallbackTimer=null,syncing=false,pending=new Set(),connectedUser=null,activeRoom=null,transport=null,openingRoom=false;
 let chatOpen=false,chatData=null,chatLoading=false,chatSending=false,lastChatSignature='',live=true;
 const widget=document.createElement('aside');widget.id='support-widget';widget.hidden=true;document.body.append(widget);
 widget.innerHTML='<button class="support-fab" data-action="chat-toggle" aria-label="گفت‌وگو با پشتیبانی" aria-expanded="false">✉<i hidden></i></button><section class="chat-panel" hidden role="dialog" aria-label="گفت‌وگو با پشتیبانی"><header><div><span class="online-dot"></span><b>پشتیبانی ناوگان</b><small>پیامت را همین‌جا بنویس</small></div><button class="ghost small" data-action="chat-toggle" aria-label="بستن گفتگو">×</button></header><div class="chat-messages" aria-live="polite"></div><form id="support-chat"><label class="sr-only" for="chat-text">پیام به پشتیبانی</label><textarea id="chat-text" name="message" rows="2" maxlength="4000" required placeholder="پیام شما…"></textarea><button type="submit" class="button small" aria-label="ارسال پیام">➤</button><span class="chat-error" role="status"></span></form></section>';
 function status(text,online){const el=$('#connection-state');if(el){el.textContent=text;el.classList.toggle('offline',!online);}}
 function updateChrome(){widget.hidden=!state.data||state.data.disabled||state.view==='game';document.body.classList.toggle('battle-mode',state.view==='game');
  const incoming=(state.data?.social?.requests||[]).filter(x=>x.recipient_id===state.data?.profile?.id).length+(state.data?.social?.rooms||[]).filter(x=>x.guest_id===state.data?.profile?.id&&x.status==='pending').length;
  const nav=document.querySelector('[data-nav="friends"]');if(nav)nav.innerHTML='◎ دوستان'+(incoming?' <span class="count-badge">'+num(incoming)+'</span>':'');
 }
 async function heartbeat(online=true){if(!state.session||!state.data||state.data.disabled)return;try{await call('heartbeat',{online});}catch{status('ارتباط ضعیف',false);}}
 function disconnect(){stopWatch?.();stopWatch=null;clearInterval(heartbeatTimer);clearInterval(fallbackTimer);clearTimeout(syncTimer);connectedUser=null;pending.clear();chatOpen=false;chatData=null;lastChatSignature='';widget.querySelector('.chat-messages').replaceChildren();widget.querySelector('textarea').value='';widget.querySelector('.support-fab').setAttribute('aria-expanded','false');widget.querySelector('.chat-panel').hidden=true;widget.hidden=true;transport?.close();transport=null;activeRoom=null;}
 async function connect(){
  const uid=state.data?.profile?.id;if(!uid||state.data.disabled)return;
  if(connectedUser===uid)return;
  disconnect();connectedUser=uid;await client.realtime.setAuth(state.session.access_token);await heartbeat(true);
  stopWatch=watchAccount(client,{userId:uid,admin:state.data.admin,onChange:(table,payload)=>{
   if(table==='ss_wallets'&&payload.new?.user_id===uid&&payload.new?.balance!==undefined){state.data.balance=payload.new.balance;const el=$('#coinbalance');if(el)el.textContent=num(payload.new.balance);}
   if(table==='ss_ticket_messages'&&state.currentTicket&&state.ticketDetails){call('ticketMessages',{ticket_id:state.currentTicket}).then(data=>{state.ticketDetails=data;const thread=$('#admin-chat-thread');if(thread)thread.innerHTML=data.messages.map(m=>'<div class="ticket-message '+(m.author_id===uid?'owner':'')+'"><small>'+dateFa(m.created_at)+'</small><div>'+esc(m.message)+'</div>'+(m.attachment_path?'<button class="ghost small" data-action="ticket-file" data-path="'+esc(m.attachment_path)+'">دریافت پیوست</button>':'')+'</div>').join('');}).catch(()=>{});}
   if(table==='ss_ticket_messages'){if(chatOpen)loadChat(false);else if(payload.new?.author_id!==uid)widget.querySelector('.support-fab i').hidden=false;}
   pending.add(table);clearTimeout(syncTimer);syncTimer=setTimeout(sync,450);
  },onStatus:s=>{live=s==='SUBSCRIBED';status(live?'متصل · زنده':'در حال اتصال…',live);if(live){pending.add('ss_coop_rooms');sync();}}});
  heartbeatTimer=setInterval(()=>heartbeat(!document.hidden||state.view==='game'),15000);
  // Reconcile after transport gaps, and refresh expiring online badges without reloading forms.
  fallbackTimer=setInterval(()=>{if(!document.hidden){pending.add(live?'ss_presence':'bootstrap');sync();}},live?20000:12000);
 }
 async function sync(){
  if(syncing||!state.session||!state.data||document.hidden&&state.view!=='game')return;
  syncing=true;const changed=new Set(pending);pending.clear();
  try{
   const socialOnly=[...changed].every(t=>['ss_friend_requests','ss_friendships','ss_presence','ss_coop_rooms'].includes(t));
   if(socialOnly)state.data.social=await call('social');else {const data=await call('bootstrap');if(state.session)state.data=data;}
   updateChrome();
   if(state.data.disabled){state.gameStop?.();state.gameStop=null;transport?.close();transport=null;activeRoom=null;state.view='home';render();return;}
   const room=state.data.social?.rooms?.find(r=>r.status==='active');
   if(room&&state.view!=='game'&&!openingRoom&&!activeRoom)await startCoop(room);
   if(activeRoom){const current=await call('roomStatus',{id:activeRoom.id});if(current.status==='completed'&&state.gameStop){state.gameStop.finish(current.result.battle);return;}if(current.status==='cancelled'){state.gameStop?.();state.gameStop=null;transport?.close();transport=null;activeRoom=null;state.view='friends';toast('نبرد مشترک لغو شد.');render();return;}}
   const typing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
   if(!typing&&state.view!=='game'&&state.view!=='result'&&state.view!=='admin')render();
   if(state.view==='admin'&&!typing&&!state.currentTicket&&!state.editingUser&&!state.editingPackage&&!state.editingDiscount){state.adminData=null;render();}
  }catch(e){status('در انتظار اتصال',false);console.warn('Account sync deferred',e.message);}
  finally{syncing=false;if(pending.size)syncTimer=setTimeout(sync,500);}
 }
 document.addEventListener('visibilitychange',()=>{if(connectedUser){heartbeat(!document.hidden||state.view==='game');if(!document.hidden){pending.add('bootstrap');sync();}}});
 window.addEventListener('online',()=>{pending.add('bootstrap');sync();});window.addEventListener('offline',()=>status('آفلاین',false));
 function renderHangar(){
  const i=state.data.inventory||{},l=state.data.loadout||{},owned=i.drones||[],equipped=i.equipped_drones||[];
  setPage('<div class="section-head"><div><div class="eyebrow">FLEET ENGINEERING / 03</div><h2>آشیانهٔ سفینه</h2><p>پهپادها را تجهیز کن و با منابع استخراج‌شده قطعات بساز.</p></div><span class="chip">'+esc(PILOTS[l.autopilot||'none'].name)+'</span></div><div class="resource-strip"><span>⬡ آهن <b>'+num(i.iron)+'</b></span><span>◆ کریستال <b>'+num(i.crystal)+'</b></span><span>ϟ انرژی <b>'+num(i.energy)+'</b></span><span>◈ سپر خودکار <b>'+(l.auto_shield?'فعال':'ندارد')+'</b></span></div><div class="cards">'+Object.entries(DRONES).map(([id,d],index)=>'<article class="card drone-card"><span class="card-index">0'+(index+1)+'</span><div class="drone-art '+id+'"><i></i><i></i><b>◈</b></div><h3>'+d.name+'</h3><p>'+({gun:'از دو طرف سفینه شلیک می‌کند و به دشمنان آسیب می‌زند.',shield:'هر ۱۵ ثانیه یک سپر سه‌ثانیه‌ای می‌سازد؛ با ساخت بدنه سریع‌تر می‌شود.',collector:'سکه و منابع را از فاصلهٔ ۱۸۵ واحد به سمت سفینه می‌کشد.'})[id]+'</p>'+(owned.includes(id)?'<button class="ghost" data-action="equip-drone" data-id="'+id+'">'+(equipped.includes(id)?'✓ تجهیز شده · برداشتن':'تجهیز پهپاد')+'</button>':'<button class="button" data-action="buy-drone" data-id="'+id+'" '+(state.data.balance<d.cost?'disabled':'')+'>خرید · '+num(d.cost)+' سکه</button>')+'</article>').join('')+'</div><div class="section-head"><h2>کارگاه قطعات</h2><p>شهاب‌سنگ‌ها و سیاره‌های قابل استخراج را در نبرد هدف بگیر.</p></div><div class="two-col">'+[['weapon','سامانهٔ تسلیحات','آسیب هر تیر ۲۵٪ بیشتر در هر سطح'],['hull','بدنهٔ تقویت‌شده','مصونیت پس از آسیب و بازیابی سریع‌تر سپر']].map(([id,name,description])=>{const level=i[id+'_level']||0,n=level+1;return '<article class="surface"><span class="chip">سطح '+num(level)+' / ۵</span><h3>'+name+'</h3><p>'+description+'</p><p class="hint">'+(level>=5?'بالاترین سطح':num(10*n)+' آهن + '+num(5*n)+' کریستال + '+num(3*n)+' انرژی')+'</p><button class="button small" data-action="craft-part" data-id="'+id+'" '+(level>=5||i.iron<10*n||i.crystal<5*n||i.energy<3*n?'disabled':'')+'>ساخت و ارتقا</button></article>';}).join('')+'</div>');
 }
 function renderFriends(){
  const s=state.data.social||{friends:[],requests:[],rooms:[]},uid=state.data.profile.id;
  const incoming=s.requests.filter(r=>r.recipient_id===uid),outgoing=s.requests.filter(r=>r.sender_id===uid);
  setPage('<div class="section-head"><div><div class="eyebrow">CO-OP / CONNECT ACROSS THE GALAXY</div><h2>ناوگان دوستان</h2><p>درخواست دوستی و سپس دعوت نبرد باید توسط طرف مقابل تأیید شوند.</p></div><span class="chip">'+num(s.friends.filter(x=>x.online).length)+' دوست آنلاین</span></div><div class="two-col"><section class="surface"><h3>افزودن دوست</h3><form id="friend-request" class="inline-form"><label class="sr-only" for="friend-username">نام کاربری دوست</label><input id="friend-username" name="username" dir="ltr" autocomplete="off" pattern="[A-Za-z0-9_]{3,24}" required placeholder="username"><button type="submit" class="button small">درخواست دوستی</button></form><p class="hint">دوستی تنها پس از قبول درخواست، برای هر دو حساب ثبت می‌شود.</p>'+outgoing.map(r=>'<p class="hint">'+esc(r.username)+' · منتظر پاسخ دوستی</p>').join('')+'</section><section class="surface"><h3>درخواست‌های دریافتی</h3>'+(incoming.length?incoming.map(r=>'<div class="friend-row"><b>'+esc(r.username)+'</b><div><button class="button small" data-action="answer-friend" data-id="'+r.id+'" data-accept="true">قبول</button> <button class="ghost small" data-action="answer-friend" data-id="'+r.id+'" data-accept="false">رد</button></div></div>').join(''):'<p>درخواست جدیدی نداری.</p>')+'</section></div>'+
  (s.rooms.length?'<section class="surface"><h3>دعوت نبرد</h3>'+s.rooms.map(r=>'<div class="friend-row"><div><b>نبرد مرحلهٔ '+num(r.stage)+'</b><p class="hint">'+(r.status==='active'?'نبرد آماده است':r.host_id===uid?'در انتظار تأیید دوست':'یک دوست تو را به نبرد دعوت کرده است')+'</p></div><div>'+(r.status==='pending'&&r.guest_id===uid?'<button class="button small" data-action="answer-coop" data-id="'+r.id+'" data-accept="true">قبول و ورود</button> <button class="ghost small" data-action="answer-coop" data-id="'+r.id+'" data-accept="false">رد</button>':r.status==='active'?'<button class="button small" data-action="resume-coop" data-id="'+r.id+'">ورود به نبرد</button>':'')+' <button class="ghost small" data-action="cancel-coop" data-id="'+r.id+'">لغو</button></div></div>').join('')+'</section>':'')+
  '<div class="cards">'+(s.friends.length?s.friends.map(f=>'<article class="card"><div class="friend-avatar">'+esc(f.first_name?.slice(0,1)||'✦')+'</div><h3>'+esc(f.first_name||f.username)+'</h3><p dir="ltr">@'+esc(f.username)+'</p><span class="presence '+(f.online?'online':'')+'">'+(f.online?'● آنلاین':'○ آفلاین')+'</span><form class="coop-invite" data-friend="'+f.id+'"><label class="hint" for="stage-'+f.id+'">مرحلهٔ مشترک</label><select id="stage-'+f.id+'" name="stage">'+Array.from({length:200},(_,i)=>i+1).filter(n=>n===1||state.data.progress.some(p=>p.stage===n-1&&p.cleared&&p.best_score>=75)).map(n=>'<option value="'+n+'">مرحلهٔ '+num(n)+(n%10===0?' · باس':'')+'</option>').join('')+'</select><button type="submit" class="button small" '+(!f.online?'disabled':'')+'>دعوت به بازی دونفره</button></form></article>').join(''):'<div class="surface empty">با نام کاربری یک دوست شروع کن؛ هر دو باید برای نبرد آنلاین باشید.</div>')+'</div>');
 }
 async function loadChat(focus=false){
  if(chatLoading)return;chatLoading=true;
  try{chatData=await call('supportChat');const messages=widget.querySelector('.chat-messages'),signature=chatData.messages.map(m=>m.id).join('|');
   if(lastChatSignature!==signature||!messages.children.length){messages.innerHTML=chatData.messages.length?chatData.messages.map(m=>'<div class="chat-bubble '+(m.author_id===state.data.profile.id?'mine':'theirs')+'"><span>'+esc(m.message)+'</span>'+(m.attachment_path?'<button class="ghost small" data-action="ticket-file" data-path="'+esc(m.attachment_path)+'">دریافت پیوست</button>':'')+'<time>'+dateFa(m.created_at)+'</time></div>').join(''):'<div class="chat-welcome"><span>✦</span><h3>سلام فرمانده!</h3><p>هر جا کمک خواستی، پیامت را بنویس. پاسخ پشتیبانی همین‌جا نمایش داده می‌شود.</p></div>';lastChatSignature=signature;messages.scrollTop=messages.scrollHeight;}
   widget.querySelector('.chat-error').textContent='';if(focus)widget.querySelector('textarea').focus();
  }catch(e){widget.querySelector('.chat-error').textContent=e.message;}finally{chatLoading=false;}
 }
 async function sendChat(form){if(chatSending)return;chatSending=true;const button=form.querySelector('button'),input=form.elements.message;button.disabled=true;
  try{await call('supportSend',{message:input.value});input.value='';await loadChat(true);}catch(e){widget.querySelector('.chat-error').textContent=e.message;}finally{chatSending=false;button.disabled=false;}}
 function openChat(){chatOpen=!chatOpen;widget.querySelector('.chat-panel').hidden=!chatOpen;widget.querySelector('.support-fab').setAttribute('aria-expanded',String(chatOpen));widget.querySelector('.support-fab i').hidden=true;if(chatOpen)loadChat(true);}
 async function fullscreen(){const wrap=$('.game-wrap');if(!wrap)return;
  if(document.fullscreenElement){await document.exitFullscreen();return;}
  try{if(wrap.requestFullscreen){await wrap.requestFullscreen();return;}}catch{/* iOS / embedded browser fallback */}
  wrap.classList.toggle('expanded-game');document.body.classList.toggle('fullscreen-fallback',wrap.classList.contains('expanded-game'));
 }
 async function startCoop(room){
  if(openingRoom||state.view==='game')return;openingRoom=true;activeRoom=room;
  try{state.view='game';chrome();setPage('<section class="loading"><div class="orbit"></div><h2>در حال اتصال به هم‌تیمی…</h2><button class="ghost" data-action="leave-game">خروج از نبرد</button></section>');transport=await openCoopTransport(client,room,state.data.profile.id);if(activeRoom?.id!==room.id){transport.close();transport=null;return;}await play({id:room.host_id===state.data.profile.id?room.host_run:room.guest_run,stage:room.stage,enemies:mission(room.stage).count,loadouts:[room.host_loadout,room.guest_loadout],seed:room.seed},room);
  }catch(e){transport?.close();transport=null;await call('cancelCoop',{id:room.id}).catch(()=>{});activeRoom=null;state.view='friends';render();toast(e.message,true);}finally{openingRoom=false;}
 }
 async function play(run,room=null){
  const stage=run.stage,cfg=mission(stage);state.gameRun=run;state.gameStage=stage;state.view='game';chrome();
  const localLoadout=room?run.loadouts[room.host_id===state.data.profile.id?0:1]:run.loadout;
  setPage('<div class="game-wrap"><div class="game-head"><div><span class="eyebrow">'+(room?'CO-OP · SHARED MISSION':'SOLO MISSION')+'</span><h2>مرحلهٔ '+num(stage)+(cfg.boss?' · '+cfg.bossName:' · فصل '+num(cfg.chapter))+'</h2></div><div class="game-metrics"><span class="metric" id="hearts">♥ ۵</span><span class="metric" id="kills">هدف: ۰ / '+num(run.enemies)+'</span><button class="ghost small" data-action="fullscreen" aria-label="تمام‌صفحه">⛶ تمام‌صفحه</button><button class="ghost small" data-action="leave-game">خروج</button></div></div><canvas id="battle" width="900" height="540" tabindex="0" aria-label="نبرد فضایی؛ جهت‌نما برای حرکت و B برای بمب"></canvas><div class="battle-toolbar"><button class="ghost small" data-action="game-pause" '+(room?'disabled':'')+'>توقف / ادامه · P</button><button class="ghost small" data-action="game-bomb">بمب · B <span id="bomb-count">۰</span></button><button class="ghost small" data-action="game-pilot" '+(localLoadout?.autopilot==='none'?'disabled':'')+' id="pilot-control">'+esc(PILOTS[localLoadout?.autopilot||'none'].name)+'</button><span id="battle-effects" class="hint"></span></div><p class="game-instructions">جهت‌نما، WASD، موس یا لمس برای حرکت؛ شلیک خودکار است. آیتم بمب را بردار و با B فعال کن. سیاره‌ها و شهاب‌سنگ‌ها منابع دارند. '+(room?'برداشتن قلب، هم‌تیمی ازکارافتاده را احیا می‌کند.':'')+'</p></div>');
  const {startShooter}=await import('./game.js');
  state.gameStop=startShooter($('#battle'),{stage,count:run.enemies,seed:run.seed,loadouts:room?run.loadouts:[run.loadout||{}],transport,
   onProgress:o=>{if(!$('#hearts'))return;$('#hearts').textContent='♥ '+num(o.hearts);$('#kills').textContent='هدف: '+num(o.kills)+' / '+num(run.enemies);$('#bomb-count').textContent=num(o.bombs);$('#battle-effects').textContent=Object.entries(o.effects||{}).filter(([,v])=>v>0).map(([k,v])=>({shield:'سپر',triple:'لیزر',magnet:'آهنربا'})[k]+' '+num(Math.ceil(v))+'ث').join(' · ');},
   onDisconnect:async message=>{state.gameStop=null;if(room)await call('cancelCoop',{id:room.id}).catch(()=>{});transport?.close();transport=null;activeRoom=null;state.view=room?'friends':'levels';render();toast(message,true);},
   onEnd:async result=>{state.gameStop=null;document.body.classList.remove('fullscreen-fallback');await document.exitFullscreen?.().catch(()=>{});
    state.view='result';chrome();setPage('<section class="loading"><div class="orbit"></div><h2>در حال ثبت نتیجهٔ نبرد…</h2></section>');
    const save=async()=>{
     if(!room)return await call('finishGalaxy',{run:run.id,...result});
     if(room.host_id===state.data.profile.id){const r=await call('finishCoop',{id:room.id,result});return r.host;}
     for(let n=0;n<20;n++){const r=await call('roomStatus',{id:room.id});if(r.status==='completed')return r.result.guest;if(r.status==='cancelled')throw Error('نبرد توسط هم‌تیمی لغو شد');await wait(600);}
     throw Error('ثبت نتیجه توسط میزبان طول کشید. دوباره بررسی کن.');
    };
    let settled=false;
    const finish=async()=>{if(settled)return;try{const outcome=await save();settled=true;transport?.close();transport=null;activeRoom=null;state.data=await call('bootstrap');chrome();
     setPage('<section class="surface result-card"><div class="result-symbol">'+(result.won?'✦':'◇')+'</div><div class="eyebrow">'+(result.won?'MISSION COMPLETE':'MISSION ENDED')+'</div><h2>'+(result.won?'کهکشان یک قدم امن‌تر شد':'دوباره به میدان برگرد')+'</h2><p>مرحلهٔ '+num(stage)+' · امتیاز '+num(result.score)+' / ۱۰۰ · '+num(result.kills)+' دشمن</p><h3>'+num(outcome.reward)+' سکه</h3>'+(outcome.boss_bonus?'<span class="chip">پاداش باس '+num(outcome.boss_bonus)+' سکه</span>':'')+'<p>آهن '+num(outcome.resources?.iron)+' · کریستال '+num(outcome.resources?.crystal)+' · انرژی '+num(outcome.resources?.energy)+'</p><p>'+(outcome.unlocked?'مرحلهٔ بعد باز شد.':result.won?'برای پیشروی به امتیاز ۷۵ نیاز داری.':'نبرد تمام شد؛ آشیانه برای ارتقا در دسترس است.')+'</p><div class="buttons"><button class="button" data-nav="levels">مأموریت‌ها</button><button class="ghost" data-nav="hangar">آشیانه</button><button class="ghost" data-nav="friends">ناوگان دوستان</button></div></section>');
    }catch(e){setPage('<section class="surface result-card"><h2>نتیجه هنوز ثبت نشده</h2><p>'+esc(e.message)+'</p><button id="retry-save-result" class="button">تلاش دوباره</button></section>');$('#retry-save-result').addEventListener('click',finish,{once:true});}};
    await finish();
   }});
 }
 async function leave(){state.gameStop?.();state.gameStop=null;document.body.classList.remove('fullscreen-fallback');await document.exitFullscreen?.().catch(()=>{});
  if(activeRoom){await call('cancelCoop',{id:activeRoom.id}).catch(()=>{});transport?.close();transport=null;activeRoom=null;}else if(state.gameRun)await call('abandonRun',{run:state.gameRun.id}).catch(()=>{});state.gameRun=null;navigate('levels');}
 async function action(action,id,el){
  if(action==='chat-toggle'){openChat();return true;}
  if(action==='fullscreen'){await fullscreen();return true;}
  if(action==='game-pause'){state.gameStop?.pause();return true;}
  if(action==='game-bomb'){state.gameStop?.bomb();return true;}
  if(action==='game-pilot'){const mode=state.gameStop?.togglePilot();if(mode!==false)$('#pilot-control').textContent=PILOTS[mode].name;return true;}
  if(action==='buy-drone'){await call('buyDrone',{item:id});toast('پهپاد خریداری و تجهیز شد');await refresh();return true;}
  if(action==='equip-drone'){const current=state.data.inventory.equipped_drones||[],drones=current.includes(id)?current.filter(x=>x!==id):[...current,id];await call('equipDrones',{drones});await refresh();return true;}
  if(action==='craft-part'){await call('craft',{item:id});toast('قطعه ساخته و ارتقا یافت');await refresh();return true;}
  if(action==='answer-friend'){await call('answerFriend',{id,accept:el.dataset.accept==='true'});await refresh();return true;}
  if(action==='answer-coop'){const room=await call('answerCoop',{id,accept:el.dataset.accept==='true'});if(room.status==='active')await startCoop(room);else await refresh();return true;}
  if(action==='cancel-coop'){await call('cancelCoop',{id});await refresh();return true;}
  if(action==='resume-coop'){const room=await call('roomStatus',{id});if(room.status!=='active')throw Error('نبرد فعال نیست');await startCoop(room);return true;}
  return false;
 }
 async function submit(form){
  if(form.id==='support-chat'){await sendChat(form);return true;}
  if(form.id==='friend-request'){await call('requestFriend',{username:form.elements.username.value});toast('درخواست دوستی ارسال شد');await refresh();return true;}
  if(form.classList.contains('coop-invite')){await heartbeat(true);await call('inviteCoop',{friend:form.dataset.friend,stage:Number(form.elements.stage.value)});toast('دعوت ارسال شد؛ منتظر تأیید دوست بمان');await refresh();return true;}
  if(form.id==='grant-package'){const r=await call('adminGrantPackage',{package_id:form.elements.package_id.value,username:form.elements.username.value,all:form.elements.all.checked});toast('بسته به '+num(r.granted)+' حساب اختصاص یافت');return true;}
  return false;
 }
 return {connect,disconnect,updateChrome,renderHangar,renderFriends,openChat,play,leave,action,submit};
}
