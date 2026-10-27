// The Edge Function authenticates the caller before reaching any of these handlers.
const ok=(r:any)=>{if(r.error)throw new Error(r.error.message);return r.data;};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const fail=(s:string):never=>{throw new Error(s);};
const rpc=async(db:any,name:string,args:any)=>ok(await db.rpc(name,args));
export async function socialData(db:any,id:string){
 const [links,requests,rooms]=await Promise.all([
  db.from('ss_friendships').select('*').or(`user_a.eq.${id},user_b.eq.${id}`),
  db.from('ss_friend_requests').select('*').or(`sender_id.eq.${id},recipient_id.eq.${id}`).eq('status','pending').order('created_at',{ascending:false}).limit(100),
  db.from('ss_coop_rooms').select('*').or(`host_id.eq.${id},guest_id.eq.${id}`).in('status',['pending','active']).order('created_at',{ascending:false}).limit(8)
 ]);
 const friends=ok(links)||[],pending=ok(requests)||[],invitations=(ok(rooms)||[]).filter((r:any)=>r.status==='active'||Date.parse(r.expires_at)>Date.now());
 const ids=[...new Set([...friends.flatMap((x:any)=>[x.user_a,x.user_b]),...pending.flatMap((x:any)=>[x.sender_id,x.recipient_id])])].filter(x=>x!==id);
 const profiles=ids.length?ok(await db.from('ss_profiles').select('id,username,first_name,active').in('id',ids)):[];
 const presence=ids.length?ok(await db.from('ss_presence').select('user_id,last_seen,online').in('user_id',ids)):[];
 return {friends:friends.map((f:any)=>{const uid=f.user_a===id?f.user_b:f.user_a,p=profiles.find((x:any)=>x.id===uid),seen=presence.find((x:any)=>x.user_id===uid);return {id:uid,username:p?.username||'—',first_name:p?.first_name||'',online:p?.active===true&&seen?.online===true&&Date.parse(seen.last_seen)>Date.now()-45000};}),
  requests:pending.map((r:any)=>({...r,username:profiles.find((x:any)=>x.id===(r.sender_id===id?r.recipient_id:r.sender_id))?.username||'—'})),rooms:invitations};
}
export async function galaxyBootstrap(db:any,id:string){
 const [inventory,loadout,social,grants]=await Promise.all([
  db.from('ss_inventory').select('*').eq('user_id',id).maybeSingle(),
  db.rpc('ss_game_loadout',{p_user:id}),socialData(db,id),db.from('ss_package_grants').select('id,package_id,features,created_at').eq('user_id',id).order('created_at',{ascending:false}).limit(100)
 ]);
 return {inventory:ok(inventory)||{iron:0,crystal:0,energy:0,weapon_level:0,hull_level:0,drones:[],equipped_drones:[]},loadout:ok(loadout),social,grants:ok(grants)};
}
export const galaxyActions=new Set(['heartbeat','social','requestFriend','answerFriend','inviteCoop','answerCoop','roomStatus','cancelCoop','finishCoop','finishGalaxy','buyDrone','equipDrones','craft','supportChat','supportSend','abandonRun']);
export async function galaxyAction(db:any,p:any,b:any){
 const id=p.id;
 switch(b.action){
 case 'heartbeat':ok(await db.from('ss_presence').upsert({user_id:id,last_seen:new Date().toISOString(),online:b.online!==false}));return {online:b.online!==false};
 case 'social':return await socialData(db,id);
 case 'requestFriend':{const name=typeof b.username==='string'?b.username.toLowerCase().trim():'';if(!/^[a-z0-9_]{3,24}$/.test(name))fail('نام کاربری نامعتبر است');return {id:await rpc(db,'ss_request_friend',{p_user:id,p_username:name})};}
 case 'answerFriend':if(!uuid(b.id)||typeof b.accept!=='boolean')fail('پاسخ نامعتبر است');return {accepted:await rpc(db,'ss_answer_friend',{p_user:id,p_request:b.id,p_accept:b.accept})};
 case 'inviteCoop':if(!uuid(b.friend)||!Number.isInteger(b.stage))fail('دعوت نامعتبر است');return {id:await rpc(db,'ss_invite_coop',{p_user:id,p_friend:b.friend,p_stage:b.stage})};
 case 'answerCoop':if(!uuid(b.id)||typeof b.accept!=='boolean')fail('پاسخ نامعتبر است');return await rpc(db,'ss_answer_coop',{p_user:id,p_room:b.id,p_accept:b.accept});
 case 'cancelCoop':if(!uuid(b.id))fail('دعوت نامعتبر است');return {cancelled:await rpc(db,'ss_cancel_coop',{p_user:id,p_room:b.id})};
 case 'roomStatus':{if(!uuid(b.id))fail('دعوت نامعتبر است');return ok(await db.from('ss_coop_rooms').select('*').eq('id',b.id).or(`host_id.eq.${id},guest_id.eq.${id}`).single());}
 case 'finishCoop':if(!uuid(b.id)||!validResult(b.result))fail('نتیجه نامعتبر است');return await rpc(db,'ss_finish_coop',{p_user:id,p_room:b.id,p_result:b.result});
 case 'finishGalaxy':{
  if(!uuid(b.run)||!validResult(b))fail('نتیجه نامعتبر است');
  const rooms=ok(await db.from('ss_coop_rooms').select('id').or(`host_run.eq.${b.run},guest_run.eq.${b.run}`).limit(1));if(rooms.length)fail('نتیجهٔ نبرد مشترک باید توسط میزبان ثبت شود');
  return await rpc(db,'ss_finish_galaxy',{p_user:id,p_run:b.run,p_kills:b.kills,p_score:b.score,p_won:b.won,p_hearts:b.hearts,p_elapsed:b.elapsed,p_boss:b.boss_defeated,p_resources:b.resources,p_coins:b.coins});
 }
 case 'buyDrone':case 'equipDrones':case 'craft':
  return await rpc(db,'ss_hangar',{p_user:id,p_action:b.action,p_item:typeof b.item==='string'?b.item:'',p_equipped:Array.isArray(b.drones)?b.drones:[]});
 case 'abandonRun':{if(!uuid(b.run))fail('نبرد نامعتبر است');const rooms=ok(await db.from('ss_coop_rooms').select('id').or(`host_run.eq.${b.run},guest_run.eq.${b.run}`).limit(1));if(rooms.length)fail('از خروج نبرد مشترک استفاده کنید');ok(await db.from('ss_runs').update({finished_at:new Date().toISOString(),won:false,score:0}).eq('id',b.run).eq('user_id',id).is('finished_at',null));return {saved:true};}
 case 'supportChat':{
  const ticket=ok(await db.from('ss_tickets').select('*').eq('user_id',id).order('updated_at',{ascending:false}).limit(1));
  if(!ticket.length)return {ticket:null,messages:[]};
  const messages=ok(await db.from('ss_ticket_messages').select('*').eq('ticket_id',ticket[0].id).order('created_at',{ascending:false}).limit(100));return {ticket:ticket[0],messages:messages.reverse()};
 }
 case 'supportSend':if(typeof b.message!=='string'||b.message.length>4000)fail('پیام نامعتبر است');return {id:await rpc(db,'ss_support_send',{p_user:id,p_message:b.message})};
 default:fail('عملیات ناشناخته است');
 }
}
function validResult(b:any){return b&&typeof b.won==='boolean'&&typeof b.boss_defeated==='boolean'&&['kills','score','hearts','coins'].every(k=>Number.isInteger(b[k]))&&Number.isFinite(b.elapsed)&&b.elapsed>=0&&b.resources&&['iron','crystal','energy'].every(k=>Number.isInteger(b.resources[k])&&b.resources[k]>=0);}
