import {createBattle,stepBattle,battleResult,WIDTH as W,HEIGHT as H,POWERUPS,PILOTS} from './game-core.js';

export function startShooter(canvas,{stage,count,onProgress=()=>{},onEnd=()=>{},loadouts=[{}],seed=1,transport=null,onDisconnect=()=>{}}){
 const ctx=canvas.getContext('2d',{alpha:false});canvas.width=W;canvas.height=H;
 const isHost=!transport||transport.isHost,index=transport&&!isHost?1:0;
 let world=createBattle({stage,count,loadouts,seed}),running=true,paused=false,last=performance.now(),frame=0,progressClock=0,netClock=0,readyClock=0;
 let remoteReady=!transport,remoteTime=performance.now(),remoteInput={},lastSequence=-1,sequence=0,disconnectSent=false,ended=false;
 let pointerPosition=null,bomb=false,unsubscribe=null;
 const permittedPilot=world.players[index]?.loadout.autopilot||'none';
 const keys=new Set();
 const stars=Array.from({length:100},(_,i)=>({x:i*173.27%W,y:i*93.17%H,size:i%8?1:2}));
 const gradient=ctx.createLinearGradient(0,0,W,H);gradient.addColorStop(0,'#040b18');gradient.addColorStop(.5,'#10183a');gradient.addColorStop(1,'#071c2e');
 function pointer(e){const b=canvas.getBoundingClientRect();const scale=Math.min(b.width/W,b.height/H);pointerPosition={x:(e.clientX-b.left-(b.width-W*scale)/2)/scale,y:(e.clientY-b.top-(b.height-H*scale)/2)/scale};canvas.focus?.({preventScroll:true});}
 function typing(e){return ['INPUT','TEXTAREA','SELECT','BUTTON'].includes(e.target?.tagName)||e.target?.isContentEditable;}
 function keydown(e){
  if(typing(e))return;
  const k=e.key.toLowerCase();
  if(['arrowup','arrowdown','arrowleft','arrowright',' ','w','a','s','d','p','b'].includes(k)){e.preventDefault();keys.add(k);pointerPosition=null;
   if(k==='p'&&!e.repeat&&!transport)paused=!paused;
   if(k==='b'&&!e.repeat)bomb=true;
  }
 }
 function keyup(e){keys.delete(e.key.toLowerCase());}
 function blur(){keys.clear();if(!transport)paused=true;}
 function destroy(){
  if(!running)return;running=false;cancelAnimationFrame(frame);unsubscribe?.();
  canvas.removeEventListener('pointermove',pointer);canvas.removeEventListener('pointerdown',pointer);
  window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);
 }
 function complete(){if(ended)return;ended=true;const result=battleResult(world);destroy();onEnd(result);}
 if(transport){
  unsubscribe=transport.listen(message=>{
   if(!running||!message||typeof message!=='object')return;
   if(message.type==='quit'){destroy();onDisconnect('هم‌تیمی از نبرد خارج شد.');return;}
   if(isHost&&message.type==='input'){
    remoteReady=true;remoteTime=performance.now();const i=message.input||{};
    remoteInput={dx:Math.max(-1,Math.min(1,Number(i.dx)||0)),dy:Math.max(-1,Math.min(1,Number(i.dy)||0)),bomb:i.bomb===true};
    if(Number.isFinite(i.x)&&Number.isFinite(i.y)){remoteInput.x=Math.max(22,Math.min(878,i.x));remoteInput.y=Math.max(280,Math.min(510,i.y));}
    if(i.manual===true)world.players[1].loadout.autopilot='none';else world.players[1].loadout.autopilot=loadouts[1]?.autopilot||'none';
   }
   if(!isHost&&message.type==='snapshot'&&Number.isSafeInteger(message.sequence)&&message.sequence>lastSequence){
    const next=message.world;
    if(next?.version!==1||next.players?.length!==2||!Array.isArray(next.enemies)||next.enemies.length>25||!Array.isArray(next.bullets)||next.bullets.length>200||!Array.isArray(next.enemyBullets)||next.enemyBullets.length>200)return;
    lastSequence=message.sequence;world=next;remoteReady=true;remoteTime=performance.now();
   }
  });
 }
 canvas.addEventListener('pointermove',pointer);canvas.addEventListener('pointerdown',pointer);
 window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);
 const ship=(p,color,enemy=false,r=17)=>{
  ctx.save();ctx.translate(p.x,p.y);if(enemy)ctx.rotate(Math.PI);
  ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=10;
  ctx.beginPath();ctx.moveTo(0,-r*1.65);ctx.lineTo(r*1.2,r);ctx.lineTo(r*.3,r*.6);ctx.lineTo(0,r);ctx.lineTo(-r*.3,r*.6);ctx.lineTo(-r*1.2,r);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;ctx.fillStyle='#dffaff';ctx.beginPath();ctx.moveTo(0,-r);ctx.lineTo(r*.25,r*.3);ctx.lineTo(-r*.25,r*.3);ctx.closePath();ctx.fill();
  if(!enemy){ctx.fillStyle='#fbcb8c';ctx.fillRect(-3,r,6,8+Math.sin(world.elapsed*40)*4);}
  ctx.restore();
 };
 const circle=(x,y,r,color,fill=true)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx[fill?'fillStyle':'strokeStyle']=color;fill?ctx.fill():ctx.stroke();};
 function draw(){
  ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);
  for(const s of stars){ctx.fillStyle=s.size===2?'#9ed4ea':'#52718b';ctx.fillRect(s.x,(s.y+world.elapsed*(10+s.size*12))%H,s.size,s.size);}
  ctx.strokeStyle='#80b3e00b';ctx.lineWidth=1;for(let y=30;y<H;y+=70){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  for(const h of world.hazards){
   ctx.save();ctx.translate(h.x,h.y);
   if(h.type==='blackhole'){
    ctx.rotate(h.phase*.45);ctx.scale(1,.55);circle(0,0,h.r+16,'#946bf780',false);ctx.lineWidth=5;circle(0,0,h.r+6,'#775edbb0',false);circle(0,0,h.r,'#01030e');
   }else if(h.type==='gravity'){
    ctx.strokeStyle='#7ed6fb44';for(let j=0;j<4;j++)circle(0,0,(h.phase*20+j*24)%105,'#7ed6fb44',false);
   }else if(h.type==='storm'){
    circle(0,0,h.r,h.phase%4>2.6?'#a997ff35':'#a997ff0c');ctx.strokeStyle='#b9abff';ctx.lineWidth=2;
    if(h.phase%4>2.3){ctx.beginPath();ctx.moveTo(-h.r,0);ctx.lineTo(-15,-22);ctx.lineTo(0,15);ctx.lineTo(25,-20);ctx.lineTo(h.r,0);ctx.stroke();}
   }else if(h.type==='planet'){
    circle(0,0,h.r,'#305a70');circle(-10,-8,h.r*.65,'#467b83');circle(8,10,12,'#22465e');circle(0,0,h.r+6,'#73e7c733',false);
   }else{
    ctx.rotate(h.phase*.3);ctx.fillStyle=h.type==='ore'?'#687d92':'#827161';ctx.beginPath();for(let j=0;j<8;j++){const a=j*Math.PI/4,r=h.r*(j%2?.8:1);j?ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r):ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();circle(-5,-6,6,'#343e53');
   }
   ctx.restore();
  }
  for(const e of world.enemies)ship(e,['#fa8da0','#b69fff','#ffbc87'][e.kind],true,e.r);
  const boss=world.boss;
  if(boss){
   ctx.save();ctx.translate(boss.x,boss.y);ctx.fillStyle=['','#7b5aa5','#8b477f','#9d485d'][boss.phase];ctx.strokeStyle='#f0b9ff';ctx.lineWidth=2;
   ctx.beginPath();ctx.moveTo(-80,-17);ctx.lineTo(-60,30);ctx.lineTo(-25,43);ctx.lineTo(0,28);ctx.lineTo(25,43);ctx.lineTo(60,30);ctx.lineTo(80,-17);ctx.lineTo(35,-32);ctx.lineTo(-35,-32);ctx.closePath();ctx.fill();ctx.stroke();circle(0,3,17,'#ffbfcf');[-55,55].forEach(x=>circle(x,12,8,'#ffc88b'));ctx.restore();
   ctx.fillStyle='#34263e';ctx.fillRect(225,18,450,7);ctx.fillStyle='#ff8ca8';ctx.fillRect(225,18,450*boss.hp/boss.maxHp,7);
   ctx.textAlign='center';ctx.fillStyle='#ffd6e4';ctx.font='12px Tahoma';ctx.fillText(world.config.bossName+' · '+boss.phase,450,44);
  }
  ctx.fillStyle='#92f7ec';for(const b of world.bullets)ctx.fillRect(b.x-2,b.y-9,4,16);
  for(const b of world.enemyBullets)circle(b.x,b.y,b.r,'#ffb983');
  for(const item of world.pickups){
   const power=POWERUPS[item.type];circle(item.x,item.y,12,(power?.color||'#a3d5ac')+'25');circle(item.x,item.y,12,power?.color||'#a3d5ac',false);
   ctx.font='bold 13px Tahoma';ctx.textAlign='center';ctx.fillStyle=power?.color||'#e9e0a7';ctx.fillText(power?.glyph||({coin:'●',iron:'Fe',crystal:'◆',energy:'ϟ'})[item.type],item.x,item.y+5);
  }
  world.players.forEach((p,i)=>{
   const color=i===0?'#81eee0':'#c0b2ff';
   if(p.hearts<=0){ctx.font='12px Tahoma';ctx.textAlign='center';ctx.fillStyle='#ffb4c8';ctx.fillText('نیاز به احیا ♥',p.x,p.y);return;}
   if(!p.immune||Math.round(world.elapsed*9)%2===0)ship(p,color);
   if(p.effects.shield>0)circle(p.x,p.y,29,'#8cedeb99',false);
   p.loadout.drones.forEach((type,j)=>{const x=p.x+(j-1)*40,y=p.y+26+Math.sin(world.elapsed*3+j)*4;circle(x,y,7,type==='gun'?'#ffd394':type==='shield'?'#7ce9fa':'#c8b2ff');circle(x,y,3,'#112438');});
   ctx.textAlign='center';ctx.font='11px Tahoma';ctx.fillStyle=color;ctx.fillText((i===index?'شما':'هم‌تیمی')+' · '+p.hearts+' ♥',p.x,p.y+56);
  });
  for(const s of world.sparks||[]){ctx.globalAlpha=Math.max(0,s.life);ctx.fillStyle=s.color;ctx.fillRect(s.x,s.y,3,3);}ctx.globalAlpha=1;
  // Small tactical radar stays clear of the boss bar.
  ctx.fillStyle='#061424d9';ctx.fillRect(784,15,100,65);ctx.strokeStyle='#4b818d';ctx.strokeRect(784,15,100,65);
  for(const e of world.enemies)circle(788+e.x/10,19+e.y/10,2,'#fb8ba4');world.players.forEach(p=>circle(788+p.x/10,19+p.y/10,2,'#88f5d7'));
  ctx.textAlign='left';ctx.fillStyle='#9bbed0';ctx.font='11px Tahoma';ctx.fillText('SECTOR '+String(stage).padStart(3,'0')+' / 200',18,25);ctx.fillText('TARGETS '+world.kills+' / '+world.count,18,45);
  if(world.noticeTime>0){ctx.fillStyle='#0a1c30d9';ctx.fillRect(220,93,460,35);ctx.fillStyle='#e0eafe';ctx.textAlign='center';ctx.font='14px Tahoma';ctx.fillText(world.notice,450,116);}
  if(world.freeze>0){ctx.fillStyle='#70b9ff0b';ctx.fillRect(0,0,W,H);}
  const networkWait=transport&&(!remoteReady||performance.now()-remoteTime>6000);
  if(paused||networkWait){ctx.fillStyle='#061025d9';ctx.fillRect(0,0,W,H);ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='bold 28px Tahoma';ctx.fillText(paused?'PAUSED':'در انتظار ارتباط با هم‌تیمی…',W/2,H/2);}
 }
 function loop(t){
  if(!running)return;
  const dt=Math.min(.04,Math.max(0,(t-last)/1000));last=t;
  const p=world.players[index],input={...(pointerPosition||{dx:Number(keys.has('arrowright')||keys.has('d'))-Number(keys.has('arrowleft')||keys.has('a')),dy:Number(keys.has('arrowdown')||keys.has('s'))-Number(keys.has('arrowup')||keys.has('w'))}),bomb,manual:p.loadout.autopilot==='none'};
  const stale=transport&&t-remoteTime>6000;
  if(transport&&t-remoteTime>30000&&!disconnectSent){disconnectSent=true;destroy();onDisconnect('ارتباط هم‌تیمی قطع شد؛ نبرد بدون پاداش پایان یافت.');return;}
  if(isHost&&!paused&&remoteReady&&!stale){stepBattle(world,dt,[input,remoteInput]);remoteInput.bomb=false;}
  netClock+=dt;readyClock+=dt;progressClock+=dt;
  if(transport){
   if(!isHost&&(netClock>=.05||!remoteReady&&readyClock>=.5)){transport.send({type:'input',input});netClock=0;readyClock=0;bomb=false;}
   if(isHost&&netClock>=.1&&remoteReady){const {sparks,...snapshot}=world;transport.send({type:'snapshot',sequence:++sequence,world:snapshot});netClock=0;}
  }
  if(!transport||isHost)bomb=false;
  if(progressClock>.15){onProgress({...battleResult(world),hearts:p.hearts,remaining:world.count-world.kills,bombs:p.bombs,effects:p.effects,autopilot:p.loadout.autopilot,boss:world.boss});progressClock=0;}
  if(world.done){if(transport&&isHost){const {sparks,...snapshot}=world;transport.send({type:'snapshot',sequence:++sequence,world:snapshot});}complete();return;}
  draw();frame=requestAnimationFrame(loop);
 }
 const stop=()=>{transport?.send({type:'quit'});destroy();};
 stop.pause=()=>{if(!transport)paused=!paused;};stop.bomb=()=>{bomb=true;};
 stop.togglePilot=()=>{if(permittedPilot==='none')return false;const p=world.players[index];p.loadout.autopilot=p.loadout.autopilot==='none'?permittedPilot:'none';return p.loadout.autopilot;};
 stop.finish=result=>{if(ended)return;ended=true;destroy();onEnd(result);};
 frame=requestAnimationFrame(loop);return stop;
}
