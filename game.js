// Canvas arcade engine. Player health is five hearts per run; radar tracks every active ship.
export function startShooter(canvas,{stage,count,onProgress,onEnd}){
 const ctx=canvas.getContext("2d");
 const W=900,H=540;
 canvas.width=W;canvas.height=H;
 let running=true,paused=false,ended=false,frame=0,last=performance.now(),elapsed=0,killed=0,spawned=0,hearts=5;
 let player={x:450,y:460,r:17,immune:0,fire:0};
 let bullets=[],enemyBullets=[],enemies=[],sparks=[];
 const keys=new Set(),stars=Array.from({length:90},(_,i)=>({x:(i*193.2)%W,y:(i*97.4)%H,size:i%9?1:2,twinkle:i*.45}));
 const move=e=>{
  const b=canvas.getBoundingClientRect();
  player.x=Math.max(20,Math.min(W-20,(e.clientX-b.left)*W/b.width));
  player.y=Math.max(290,Math.min(H-38,(e.clientY-b.top)*H/b.height));
 };
 const keydown=e=>{if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","w","a","s","d","W","A","S","D","p","P"].includes(e.key)){if(e.target===document.body)e.preventDefault();keys.add(e.key);if((e.key==="p"||e.key==="P")&&!e.repeat)paused=!paused;}};
 const keyup=e=>keys.delete(e.key);
 const blur=()=>{keys.clear();paused=true;};
 const pointer=e=>{if(running)move(e);};
 canvas.addEventListener("pointermove",pointer);canvas.addEventListener("pointerdown",pointer);
 window.addEventListener("keydown",keydown);window.addEventListener("keyup",keyup);window.addEventListener("blur",blur);
 const rand=(a,b)=>a+Math.random()*(b-a);
 const destroy=()=>{
  running=false;cancelAnimationFrame(frame);canvas.removeEventListener("pointermove",pointer);canvas.removeEventListener("pointerdown",pointer);
  window.removeEventListener("keydown",keydown);window.removeEventListener("keyup",keyup);window.removeEventListener("blur",blur);
 };
 function finish(won){
  if(ended)return;ended=true;
  const score=won?Math.max(0,Math.min(100,100-(5-hearts)*9-Math.floor(Math.max(0,elapsed-38)*0.35))):0;
  destroy();onEnd({won,kills:killed,score,hearts,elapsed:Math.round(elapsed*1000)/1000});
 }
 function drawShip(x,y,r,color,enemy=false){
  ctx.save();ctx.translate(x,y);
  if(enemy)ctx.rotate(Math.PI);
  ctx.shadowColor=color;ctx.shadowBlur=20;ctx.fillStyle=color;
  ctx.beginPath();ctx.moveTo(0,-r*1.7);ctx.lineTo(r*.8,r*.9);ctx.lineTo(0,r*.4);ctx.lineTo(-r*.8,r*.9);ctx.closePath();ctx.fill();
  ctx.shadowBlur=0;ctx.fillStyle="#f5feff";ctx.beginPath();ctx.moveTo(0,-r*.85);ctx.lineTo(5,2);ctx.lineTo(-5,2);ctx.closePath();ctx.fill();
  ctx.restore();
 }
 function explosion(x,y,color){
  for(let j=0;j<12;j++)sparks.push({x,y,dx:rand(-120,120),dy:rand(-140,110),life:rand(.25,.7),color});
 }
 function hit(a,b,r){return Math.hypot(a.x-b.x,a.y-b.y)<r;}
 function radar(){
  const cx=799,cy=105,rad=83;
  ctx.save();ctx.fillStyle="#051929dd";ctx.strokeStyle="#36dcfa";ctx.lineWidth=1.1;
  ctx.beginPath();ctx.arc(cx,cy,rad+5,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.strokeStyle="#2b6a78aa";
  for(let r=1;r<=3;r++){ctx.beginPath();ctx.arc(cx,cy,rad*r/3,0,Math.PI*2);ctx.stroke();}
  ctx.beginPath();ctx.moveTo(cx-rad,cy);ctx.lineTo(cx+rad,cy);ctx.moveTo(cx,cy-rad);ctx.lineTo(cx,cy+rad);ctx.stroke();
  const angle=elapsed*.9;
  ctx.strokeStyle="#58ffaeaa";ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+rad*Math.cos(angle),cy+rad*Math.sin(angle));ctx.stroke();
  const dot=(x,y,color,r=3)=>{const px=cx-rad+2*x/W*rad,py=cy-rad+2*y/H*rad;ctx.fillStyle=color;ctx.beginPath();ctx.arc(px,py,r,0,Math.PI*2);ctx.fill();};
  for(const e of enemies)dot(e.x,e.y,"#ff638f",3);
  dot(player.x,player.y,"#6affc7",4);
  ctx.fillStyle="#7aeafd";ctx.font="bold 11px Tahoma";ctx.textAlign="center";ctx.fillText("RADAR · LIVE",cx,cy-rad-13);
  ctx.restore();
 }
 function update(dt){
  elapsed+=dt;player.immune=Math.max(0,player.immune-dt);player.fire=Math.max(0,player.fire-dt);
  const speed=300;
  if(keys.has("ArrowLeft")||keys.has("a")||keys.has("A"))player.x-=dt*speed;
  if(keys.has("ArrowRight")||keys.has("d")||keys.has("D"))player.x+=dt*speed;
  if(keys.has("ArrowUp")||keys.has("w")||keys.has("W"))player.y-=dt*speed;
  if(keys.has("ArrowDown")||keys.has("s")||keys.has("S"))player.y+=dt*speed;
  player.x=Math.max(20,Math.min(W-20,player.x));player.y=Math.max(290,Math.min(H-30,player.y));
  if(player.fire<=0){bullets.push({x:player.x,y:player.y-25});player.fire=.2;}
  if(spawned<count&&elapsed>=spawned*.75){
   const i=spawned++;
   enemies.push({x:100+(i*119)%690,y:-40-rand(0,50),base:100+(i*119)%690,t:rand(0,10),fire:rand(1,2),r:18});
  }
  for(const e of enemies){
   e.t+=dt;e.y+=dt*(35+Math.min(55,stage*.4));e.x=e.base+Math.sin(e.t*(1.2+stage/220))*75;
   if(e.y>H-120)e.y=25; // looping enemies remain on radar
   e.fire-=dt;if(e.fire<=0){enemyBullets.push({x:e.x,y:e.y+20,dx:(player.x-e.x)*.11});e.fire=rand(1.2,2.7)*Math.max(.5,1-stage/350);}
  }
  bullets.forEach(b=>b.y-=dt*570);
  enemyBullets.forEach(b=>{b.y+=dt*(190+Math.min(145,stage*1.1));b.x+=dt*b.dx;});
  bullets=bullets.filter(b=>b.y>-20);enemyBullets=enemyBullets.filter(b=>b.y<H+20);
  for(let i=bullets.length-1;i>=0;i--){
   const b=bullets[i];let target=enemies.findIndex(e=>hit(e,b,23));
   if(target>=0){const e=enemies.splice(target,1)[0];bullets.splice(i,1);killed++;explosion(e.x,e.y,"#ff6699");onProgress({kills:killed,hearts,remaining:count-killed});}
  }
  if(player.immune<=0)for(let i=enemyBullets.length-1;i>=0;i--){
   if(hit(player,enemyBullets[i],20)){enemyBullets.splice(i,1);hearts--;player.immune=1.25;explosion(player.x,player.y,"#48eaff");onProgress({kills:killed,hearts,remaining:count-killed});break;}
  }
  sparks.forEach(s=>{s.x+=s.dx*dt;s.y+=s.dy*dt;s.life-=dt;});sparks=sparks.filter(s=>s.life>0);
  if(hearts<=0)return finish(false);
  if(killed===count&&elapsed>=8)return finish(true);
 }
 function draw(){
  ctx.clearRect(0,0,W,H);
  const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,"#040b20");g.addColorStop(1,"#111e4a");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  for(const s of stars){ctx.fillStyle="rgba(168,210,255,"+(.3+.5*(1+Math.sin(elapsed*2+s.twinkle))/2)+")";ctx.fillRect(s.x,(s.y+elapsed*(8+s.size*16))%H,s.size,s.size);}
  ctx.strokeStyle="#1c3d66";ctx.lineWidth=1;for(let y=65;y<H;y+=70){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  for(const e of enemies)drawShip(e.x,e.y,e.r,"#fd789a",true);
  ctx.fillStyle="#7af4ff";ctx.shadowColor="#62ecff";ctx.shadowBlur=14;
  for(const b of bullets)ctx.fillRect(b.x-2,b.y-12,4,16);
  ctx.fillStyle="#ffbf68";ctx.shadowColor="#ffc15e";for(const b of enemyBullets){ctx.beginPath();ctx.arc(b.x,b.y,4.5,0,Math.PI*2);ctx.fill();}
  ctx.shadowBlur=0;
  if(Math.round(elapsed*8)%2===0||!player.immune)drawShip(player.x,player.y,player.r,"#43eaff");
  for(const s of sparks){ctx.fillStyle=s.color;ctx.globalAlpha=Math.min(1,s.life*2);ctx.fillRect(s.x,s.y,3,3);}ctx.globalAlpha=1;
  radar();
  ctx.textAlign="left";ctx.fillStyle="#d9edff";ctx.font="bold 18px Tahoma";ctx.fillText("WAVE "+stage,20,35);
  ctx.font="14px Tahoma";ctx.fillText("KILLS "+killed+"/"+count,20,60);
  if(paused){ctx.fillStyle="#061025bb";ctx.fillRect(0,0,W,H);ctx.textAlign="center";ctx.fillStyle="#fff";ctx.font="bold 35px Tahoma";ctx.fillText("PAUSED",W/2,H/2);}
 }
 function loop(t){
  if(!running)return;
  const dt=Math.min(.04,Math.max(0,(t-last)/1000));last=t;
  if(!paused)update(dt);
  if(!running)return;
  draw();frame=requestAnimationFrame(loop);
 }
 frame=requestAnimationFrame(loop);
 return destroy;
}