// Pure, deterministic simulation; the same model drives solo and host-led co-op.
export const WIDTH=900, HEIGHT=540;
export const PILOTS={none:{name:'دستی',speed:340},go:{name:'Auto-pilot Go',speed:225},plus:{name:'Auto-pilot Plus',speed:300},pro:{name:'Auto-pilot Pro',speed:360}};
export const DRONES={gun:{name:'پهپاد مهاجم',cost:650},shield:{name:'پهپاد نگهبان',cost:800},collector:{name:'پهپاد کاوشگر',cost:500}};
export const POWERUPS={shield:{label:'سپر',color:'#62eaff',glyph:'◈'},triple:{label:'لیزر سه‌تایی',color:'#b6a2ff',glyph:'Ⅲ'},bomb:{label:'بمب · B',color:'#ffbf72',glyph:'✹'},freeze:{label:'توقف زمان',color:'#9ac4ff',glyph:'Ⅱ'},magnet:{label:'آهنربا',color:'#fb9ac5',glyph:'∩'},heart:{label:'قلب',color:'#ff7c99',glyph:'♥'}};
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function scoreFor(won,hearts,elapsed){return won?clamp(100-(5-hearts)*9-Math.floor(Math.max(0,elapsed-38)*.35),0,100):0;}
export function mission(stage){
 const chapter=Math.ceil(stage/10),boss=stage%10===0;
 return {stage,chapter,boss,count:8+Math.min(12,Math.floor(stage/10)),
  bossName:chapter===1?'سفینهٔ مادر':chapter===20?'فرماندهٔ نهایی کهکشان':['شکارچی سحابی','نگهبان تاریکی','ناوشکن خلأ','امپراتور مدار'][chapter%4],
  environment:['meteor','gravity','storm','blackhole'][Math.floor((stage-1)/2)%4],bossReward:250+chapter*100};
}
export function loadout(value={}){
 return {autopilot:PILOTS[value.autopilot]?value.autopilot:'none',auto_shield:value.auto_shield===true,
  drones:[...new Set((Array.isArray(value.drones)?value.drones:[]).filter(x=>DRONES[x]))].slice(0,3),
  weapon_level:clamp(Math.floor(Number(value.weapon_level)||0),0,5),hull_level:clamp(Math.floor(Number(value.hull_level)||0),0,5)};
}
export function seededRandom(seed=1){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function pilotInput(world,p){
 const mode=p.loadout.autopilot;
 if(mode==='none'||p.hearts<=0)return {};
 const enemies=[...world.enemies,...(world.boss?[world.boss]:[])].filter(e=>e.y<p.y);
 const target=enemies.sort((a,b)=>Math.abs(a.x-p.x)-Math.abs(b.x-p.x))[0];
 let x=target?.x??WIDTH/2,y=470;
 if(mode==='plus'){
  for(const b of world.enemyBullets){const eta=(p.y-b.y)/Math.max(1,b.dy);if(eta>0&&eta<.85&&Math.abs(b.x+b.dx*eta-p.x)<45){x=p.x+(b.x<p.x?110:-110);break;}}
 }else if(mode==='pro'){
  let best=Infinity;
  for(const cy of [350,420,480])for(const cx of [...Array.from({length:12},(_,i)=>45+i*70),clamp(target?.x??450,30,870),p.x]){
   let risk=Math.abs(cx-(target?.x??450))*.55+Math.hypot(cx-p.x,cy-p.y)*.12;
   for(const b of world.enemyBullets){const eta=clamp((cy-b.y)/Math.max(1,b.dy),0,.9);const d=Math.hypot(cx-b.x-b.dx*eta,cy-b.y-b.dy*eta);risk+=8500/Math.max(35,d);}
   for(const h of world.hazards)if(h.type!=='ore'&&h.type!=='planet')risk+=8500/Math.max(20,Math.hypot(cx-h.x,cy-h.y)-h.r);
   for(const item of world.pickups)if(item.type==='heart'&&p.hearts<5||item.type==='shield')risk-=Math.max(0,140-Math.hypot(cx-item.x,cy-item.y))*.4;
   if(risk<best){best=risk;x=cx;y=cy;}
  }
 }
 return {x:clamp(x,25,875),y,bomb:mode==='pro'&&p.bombs>0&&world.enemyBullets.length>16};
}
export function createBattle({stage=1,count,loadouts=[{}],seed=1}={}){
 const config=mission(stage),random=seededRandom(seed);
 const w={version:1,config,count:count??config.count,elapsed:0,kills:0,spawned:0,nextId:1,players:loadouts.map((l,i)=>({x:loadouts.length===1?450:340+i*220,y:470,r:15,hearts:5,immune:0,fire:0,droneFire:0,shieldClock:4,autoClock:0,bombs:0,loadout:loadout(l),effects:{shield:0,triple:0,magnet:0}})),
  enemies:[],bullets:[],enemyBullets:[],pickups:[],hazards:[],sparks:[],boss:null,bossDefeated:false,freeze:0,resources:{iron:0,crystal:0,energy:0},coins:0,done:false,won:false,notice:'آمادهٔ نبرد',noticeTime:2,hazardClock:3};
 Object.defineProperty(w,'random',{value:random,enumerable:false});
 return w;
}
function burst(w,x,y,color){for(let i=0;i<10&&w.sparks.length<160;i++)w.sparks.push({x,y,dx:(w.random()-.5)*200,dy:(w.random()-.5)*200,life:.4+w.random()*.3,color});}
function notify(w,message){w.notice=message;w.noticeTime=2.5;}
function emit(w,from,target,speed=210,angle=0){
 if(w.enemyBullets.length>=180)return;
 const a=Math.atan2(target.y-from.y,target.x-from.x)+angle;
 w.enemyBullets.push({id:w.nextId++,x:from.x,y:from.y,dx:Math.cos(a)*speed,dy:Math.sin(a)*speed,r:5});
}
function pickup(w,x,y,type){if(w.pickups.length<70)w.pickups.push({id:w.nextId++,x,y,type,r:11,life:14});}
function drop(w,e){
 pickup(w,e.x,e.y,'coin');
 if(w.kills%2===0)pickup(w,e.x-18,e.y,['iron','crystal','energy'][w.kills%3]);
 if(w.kills%2===1)pickup(w,e.x+18,e.y,Object.keys(POWERUPS)[Math.floor(w.kills/2)%6]);
}
function damageEnemy(w,e,n){
 e.hp-=n;
 if(e.hp>0)return;
 if(e.boss){w.boss=null;w.bossDefeated=true;w.kills++;notify(w,'باس نابود شد · پاداش ویژهٔ فصل');}
 else {const index=w.enemies.indexOf(e);if(index<0)return;w.enemies.splice(index,1);w.kills++;drop(w,e);}
 burst(w,e.x,e.y,e.boss?'#ffc778':'#fb719d');
}
export function applyPickup(w,p,type){
 if(type==='coin'){w.coins++;return;}
 if(['iron','crystal','energy'].includes(type)){w.resources[type]=Math.min(w.count*3,w.resources[type]+1);return;}
 if(type==='shield')p.effects.shield=8;
 if(type==='triple')p.effects.triple=10;
 if(type==='bomb')p.bombs=Math.min(3,p.bombs+1);
 if(type==='freeze')w.freeze=4;
 if(type==='magnet')p.effects.magnet=10;
 if(type==='heart'){
  const down=w.players.find(x=>x.hearts===0);
  if(down){down.hearts=1;down.immune=3;notify(w,'هم‌تیمی به نبرد بازگشت');}else p.hearts=Math.min(5,p.hearts+1);
 }
 if(POWERUPS[type])notify(w,POWERUPS[type].label+' دریافت شد');
}
function hitPlayer(w,p){
 if(p.hearts<=0||p.immune>0||p.effects.shield>0)return;
 p.hearts--;p.immune=1.25+p.loadout.hull_level*.12;burst(w,p.x,p.y,'#72e8ff');
}
function stepPlayers(w,dt,inputs){
 w.players.forEach((p,index)=>{
  if(p.hearts<=0)return;
  p.immune=Math.max(0,p.immune-dt);p.fire-=dt;p.droneFire-=dt;p.shieldClock-=dt;p.autoClock-=dt;
  for(const k in p.effects)p.effects[k]=Math.max(0,p.effects[k]-dt);
  const manual=inputs[index]||{},ai=pilotInput(w,p),input=p.loadout.autopilot==='none'?manual:ai;
  let tx=p.x+(input.dx||0)*340*dt,ty=p.y+(input.dy||0)*340*dt;
  if(Number.isFinite(input.x)&&Number.isFinite(input.y)){tx=input.x;ty=input.y;}
  const distance=Math.hypot(tx-p.x,ty-p.y),speed=PILOTS[p.loadout.autopilot].speed;
  const amount=distance?Math.min(1,speed*dt/distance):0;
  p.x+=(tx-p.x)*amount;p.y+=(ty-p.y)*amount;
  if(p.loadout.auto_shield&&p.autoClock<=0&&w.enemyBullets.some(b=>b.y<p.y&&p.y-b.y<150&&Math.abs(b.x-p.x)<45)){
   p.effects.shield=Math.max(p.effects.shield,2.5);p.autoClock=16-p.loadout.hull_level;
  }
  if(p.loadout.drones.includes('shield')&&p.shieldClock<=0){p.effects.shield=Math.max(p.effects.shield,3);p.shieldClock=15-p.loadout.hull_level;}
  if(p.fire<=0){
   const offsets=p.effects.triple>0?[-.2,0,.2]:[0];
   offsets.forEach(a=>w.bullets.push({x:p.x,y:p.y-24,dx:Math.sin(a)*570,dy:-Math.cos(a)*570,damage:1+p.loadout.weapon_level*.25,owner:index}));p.fire=.21;
  }
  if(p.loadout.drones.includes('gun')&&p.droneFire<=0){[-35,35].forEach(offset=>w.bullets.push({x:p.x+offset,y:p.y,dx:0,dy:-520,damage:.7,owner:index}));p.droneFire=.48;}
  if((manual.bomb||input.bomb)&&p.bombs>0){
   p.bombs--;w.enemyBullets=[];[...w.enemies].forEach(e=>damageEnemy(w,e,4));if(w.boss)damageEnemy(w,w.boss,22);notify(w,'موج انفجار');
  }
  p.x=clamp(p.x,22,878);p.y=clamp(p.y,280,510);
 });
}
function spawn(w){
 const regular=w.count-(w.config.boss?1:0);
 if(w.spawned<regular&&w.elapsed>w.spawned*.85){
  const i=w.spawned++,base=80+(i*127)%730;
  w.enemies.push({id:w.nextId++,x:base,y:-30,base,t:i*.8,r:17,fire:1.8+w.random(),hp:1+Math.floor(w.config.chapter/8),kind:i%3,evade:0});
 }
 if(w.config.boss&&!w.bossDefeated&&!w.boss&&w.spawned===regular&&w.enemies.length===0){
  w.boss={id:w.nextId++,boss:true,x:450,y:80,r:62,hp:65+w.config.chapter*7,maxHp:65+w.config.chapter*7,phase:1,t:0,fire:1.5,special:4};
  notify(w,w.config.bossName+' · فاز ۱');
 }
}
function stepEnemies(w,dt){
 const living=w.players.filter(p=>p.hearts>0);if(!living.length)return;
 for(const e of w.enemies){
  e.t+=dt;e.y+=dt*(32+Math.min(45,w.config.stage*.22));
  const target=living.reduce((a,b)=>dist(e,a)<dist(e,b)?a:b);
  const threat=w.bullets.find(b=>b.y>e.y&&b.y-e.y<130&&Math.abs(b.x-e.x)<30);
  // Scouts evade incoming fire; squadrons converge, hunters track the player.
  const goal=e.kind===0?e.base+Math.sin(e.t*1.3)*90:e.kind===1?target.x+Math.sin(e.t)*95:e.base+Math.sin(e.t*1.8)*115;
  e.x+=clamp(goal-e.x,-95*dt,95*dt);
  if(threat&&e.kind!==1)e.x+=(threat.x<e.x?1:-1)*125*dt;
  e.x=clamp(e.x,30,870);if(e.y>355){e.y=20;e.base=clamp(target.x+120*(w.random()-.5),80,820);e.kind=(e.kind+1)%3;}
  e.fire-=dt;if(e.fire<=0){emit(w,e,target,150+Math.min(90,w.config.stage*.5));e.fire=1.8+w.random()*1.5;}
 }
 const b=w.boss;
 if(b){
  b.t+=dt;b.x=450+Math.sin(b.t*.6)*290;
  const phase=b.hp/b.maxHp>.66?1:b.hp/b.maxHp>.33?2:3;
  if(phase!==b.phase){b.phase=phase;notify(w,'فاز '+phase+' · حملات باس شدیدتر شد');}
  b.fire-=dt;b.special-=dt;
  if(b.fire<=0){const target=living[Math.floor(b.t)%living.length];for(let i=-b.phase;i<=b.phase;i++)emit(w,b,target,175+b.phase*16,i*.18);b.fire=1.35-b.phase*.19;}
  if(b.special<=0){for(let i=0;i<18;i++){const a=i*Math.PI/9;w.enemyBullets.push({id:w.nextId++,x:b.x,y:b.y,dx:Math.cos(a)*175,dy:Math.sin(a)*175,r:6});}b.special=6-b.phase;notify(w,'هشدار · موج ویژهٔ باس');}
 }
}
function stepHazards(w,dt){
 w.hazardClock-=dt;
 if(w.hazardClock<=0&&w.hazards.length<7){
  const type=w.config.environment;
  w.hazards.push({id:w.nextId++,type:type==='meteor'?'meteor':w.elapsed<5?'ore':type,x:90+w.random()*720,y:type==='meteor'?-35:150+w.random()*200,r:type==='blackhole'?42:type==='storm'?65:30,hp:4,life:11,phase:0});
  if(w.elapsed<5)w.hazards.push({id:w.nextId++,type:'planet',x:85,y:160,r:37,hp:9,life:45,phase:0});
  w.hazardClock=8;
 }
 for(const h of w.hazards){
  h.life-=dt;h.phase+=dt;if(h.type==='meteor'||h.type==='ore')h.y+=dt*85;
  for(const p of w.players){if(!p.hearts)continue;const d=dist(h,p);
   if(h.type==='blackhole'||h.type==='gravity'){
    if(d<190){const force=(h.type==='blackhole'?60:36)*(1-d/210)*dt;p.x+=(h.x-p.x)/Math.max(1,d)*force;p.y+=(h.y-p.y)/Math.max(1,d)*force;}
    if(h.type==='blackhole'&&d<h.r*.65)hitPlayer(w,p);
   }else if(h.type==='storm'){if(d<h.r&&h.phase%4>2.6)hitPlayer(w,p);}
   else if(h.type==='meteor'&&d<h.r+p.r)hitPlayer(w,p);
  }
 }
 w.hazards=w.hazards.filter(h=>h.life>0&&h.y<600&&h.hp>0);
}
export function stepBattle(w,delta,inputs=[]){
 if(w.done)return w;
 const dt=clamp(delta,0,.05);w.elapsed+=dt;w.noticeTime-=dt;w.freeze=Math.max(0,w.freeze-dt);
 const slow=dt*(w.freeze>0?.12:1);
 stepPlayers(w,dt,inputs);spawn(w);stepEnemies(w,slow);stepHazards(w,slow);
 for(const b of w.bullets){b.y+=b.dy*dt;b.x+=b.dx*dt;}
 for(const b of w.enemyBullets){b.y+=b.dy*slow;b.x+=b.dx*slow;}
 for(let i=w.bullets.length-1;i>=0;i--){
  const b=w.bullets[i],target=w.enemies.find(e=>dist(e,b)<e.r+5)||(w.boss&&dist(w.boss,b)<w.boss.r?w.boss:null);
  if(target){damageEnemy(w,target,b.damage);w.bullets.splice(i,1);continue;}
  const rock=w.hazards.find(h=>['meteor','ore','planet'].includes(h.type)&&dist(h,b)<h.r);
  if(rock){rock.hp-=b.damage;w.bullets.splice(i,1);if(rock.hp<=0){burst(w,rock.x,rock.y,'#d2b28a');['iron','crystal','energy'].forEach((type,j)=>pickup(w,rock.x+(j-1)*22,rock.y,type));}}
 }
 for(let i=w.enemyBullets.length-1;i>=0;i--){const b=w.enemyBullets[i];const p=w.players.find(p=>p.hearts>0&&dist(p,b)<p.r+b.r);if(p){hitPlayer(w,p);w.enemyBullets.splice(i,1);}}
 for(const e of w.enemies)for(const p of w.players)if(dist(e,p)<e.r+p.r)hitPlayer(w,p);
 for(const item of w.pickups){
  item.life-=dt;item.y+=dt*35;
  const p=w.players.filter(p=>p.hearts>0).sort((a,b)=>dist(a,item)-dist(b,item))[0];if(!p)continue;
  const d=dist(p,item),range=p.effects.magnet>0?300:p.loadout.drones.includes('collector')?185:28;
  if(d<range){const force=Math.min(1,dt*7);item.x+=(p.x-item.x)*force;item.y+=(p.y-item.y)*force;}
  if(dist(p,item)<27){applyPickup(w,p,item.type);item.life=-1;}
 }
 w.pickups=w.pickups.filter(i=>i.life>0&&i.y<HEIGHT+15);
 w.bullets=w.bullets.filter(b=>b.y>-40&&b.x>-20&&b.x<920).slice(-200);
 w.enemyBullets=w.enemyBullets.filter(b=>b.y>-50&&b.y<590&&b.x>-50&&b.x<950).slice(-200);
 for(const s of w.sparks){s.life-=dt;s.x+=s.dx*dt;s.y+=s.dy*dt;}w.sparks=w.sparks.filter(s=>s.life>0);
 for(const p of w.players){p.x=clamp(p.x,22,878);p.y=clamp(p.y,280,510);}
 if(w.elapsed>1700||!w.players.some(p=>p.hearts>0)){w.done=true;w.won=false;}
 else if(w.kills===w.count&&w.elapsed>=8){w.done=true;w.won=true;}
 return w;
}
export function battleResult(w){
 const hearts=w.won?Math.max(1,Math.ceil(w.players.reduce((n,p)=>n+p.hearts,0)/w.players.length)):0;
 const elapsed=Math.round(w.elapsed*1000)/1000;
 return {won:w.won,kills:w.kills,score:scoreFor(w.won,hearts,elapsed),hearts,elapsed,boss_defeated:w.bossDefeated,resources:w.resources,coins:w.coins};
}
