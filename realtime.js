// One account subscription; filters and RLS keep private data scoped to its owner.
export function watchAccount(client,{userId,admin=false,onChange,onStatus=()=>{}}){
 const channel=client.channel('ss-account:'+userId);
 const owned={ss_wallets:'user_id',ss_progress:'user_id',ss_purchases:'user_id',ss_package_grants:'user_id',ss_inventory:'user_id',ss_orders:'user_id',ss_ledger:'user_id',ss_daily_claims:'user_id',ss_profiles:'id'};
 for(const [table,column]of Object.entries(owned))channel.on('postgres_changes',{event:'*',schema:'public',table,...(admin?{}:{filter:column+'=eq.'+userId})},payload=>onChange(table,payload));
 for(const table of ['ss_packages','ss_announcements','ss_settings','ss_tickets','ss_ticket_messages','ss_friend_requests','ss_friendships','ss_presence','ss_coop_rooms'])channel.on('postgres_changes',{event:'*',schema:'public',table},payload=>onChange(table,payload));
 channel.subscribe(status=>onStatus(status));
 return ()=>client.removeChannel(channel);
}
export async function openCoopTransport(client,room,userId){
 const isHost=room.host_id===userId,other=isHost?room.guest_id:room.host_id,listeners=new Set();
 const own=client.channel(`ss-room:${room.id}:${userId}`,{config:{private:true,broadcast:{ack:false,self:false}}});
 const incoming=client.channel(`ss-room:${room.id}:${other}`,{config:{private:true,broadcast:{ack:false,self:false}}});
 let closed=false;
 incoming.on('broadcast',{event:'battle'},({payload})=>{if(JSON.stringify(payload).length<120000)for(const listener of listeners)listener(payload);});
 function subscribe(channel){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('اتصال نبرد برقرار نشد. دوباره دعوت کنید.')),12000);
  channel.subscribe((status,error)=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(error||Error('خطای اتصال نبرد'));}});
 });}
 try{await Promise.all([subscribe(own),subscribe(incoming)]);}catch(e){client.removeChannel(own);client.removeChannel(incoming);throw e;}
 return {isHost,listen(fn){listeners.add(fn);return()=>listeners.delete(fn);},send(payload){if(!closed)own.send({type:'broadcast',event:'battle',payload}).catch(()=>{});},close(){closed=true;listeners.clear();client.removeChannel(own);client.removeChannel(incoming);}};
}
