// Optional DOM integration checks: install happy-dom@21.0.4 for development.
// Run: node --experimental-vm-modules scripts/qa-ui.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
const {Window}=await import(process.env.HAPPY_DOM_MODULE||'happy-dom');
const root=resolve('.'),window=new Window({url:'http://localhost:5173',settings:{disableJavaScriptFileLoading:true,disableJavaScriptEvaluation:true,disableCSSFileLoading:true}});
window.document.write(readFileSync('index.html','utf8'));
const uid='11111111-1111-4111-8111-111111111111',friend='22222222-2222-4222-8222-222222222222';
const fixture={profile:{id:uid,first_name:'آزمایش',last_name:'رابط',username:'qa_player',active:true},balance:3000,progress:[],daily:{},settings:{},packages:[{id:'33333333-3333-4333-8333-333333333333',title:'Pro',description:'آزمایش',coins:100,autopilot:'pro',auto_shield:true}],announcements:[],ledger:[],orders:[],tickets:[],purchases:[],grants:[],admin:true,inventory:{iron:50,crystal:25,energy:20,weapon_level:0,hull_level:0,drones:[],equipped_drones:[]},loadout:{autopilot:'pro',auto_shield:true,drones:[]},social:{friends:[{id:friend,username:'friend',first_name:'دوست',online:true}],requests:[],rooms:[]}};
const session={access_token:'qa-token'},calls=[],subscriptions=[];
const fakeClient={auth:{async getSession(){return {data:{session}};},onAuthStateChange(){},async signOut(){},async signInWithPassword(){return{data:{session}};}},realtime:{async setAuth(){}},channel(){const c={on(_type,filter,handler){subscriptions.push({filter,handler});return c;},subscribe(fn){fn('SUBSCRIBED');return c;},send(){return Promise.resolve('ok');}};return c;},removeChannel(){}};
let chat=[];
const fetch=async(_url,options)=>{
 const body=JSON.parse(options.body);calls.push(body);let data={};
 if(body.action==='bootstrap')data=structuredClone(fixture);
 if(body.action==='daily')data={reward:0};
 if(body.action==='social')data=structuredClone(fixture.social);
 if(body.action==='adminData')data={users:[],wallets:[],packages:fixture.packages,discounts:[],announcements:[],tickets:[],orders:[],settings:{},tokens:[],hasMore:false};
 if(body.action==='supportChat')data={ticket:null,messages:chat};
 if(body.action==='supportSend'){chat.push({id:'message-'+chat.length,author_id:uid,message:body.message,created_at:new Date().toISOString()});data={id:'chat'};}
 if(body.action==='start')data={id:'44444444-4444-4444-8444-444444444444',stage:body.stage,enemies:8,seed:1,loadout:fixture.loadout};
 return {ok:true,async json(){return {ok:true,data};}};
};
const frames=[],timers=new Set();
const context=createContext({window,document:window.document,HTMLFormElement:window.HTMLFormElement,FormData:window.FormData,navigator:window.navigator,AbortSignal,fetch,console,performance,structuredClone,requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},setTimeout:(fn,ms)=>{if(ms===15000)return 0;const id=setTimeout(fn,ms);timers.add(id);return id;},clearTimeout, setInterval:()=>0,clearInterval(){},__client:fakeClient});
window.scrollTo=()=>{};
const modules=new Map();
async function load(file){
 file=resolve(file);if(modules.has(file))return modules.get(file);
 let source=basename(file)==='supabase-client.js'?'export function createClient(){return globalThis.__client;}':readFileSync(file,'utf8');
 if(basename(file)==='app.js')source+='\nexport {state,render,navigate,formObj,galaxy};';
 const mod=new SourceTextModule(source,{context,identifier:file,importModuleDynamically:async(spec,parent)=>{const child=await load(resolve(dirname(parent.identifier),spec));if(child.status==='linked')await child.evaluate();return child;}});
 modules.set(file,mod);await mod.link((spec,parent)=>load(resolve(dirname(parent.identifier),spec)));return mod;
}
const app=await load(resolve(root,'app.js'));await app.evaluate();
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};await flush();
const {state,navigate,formObj,galaxy}=app.namespace;
assert.match(window.document.querySelector('h1').textContent,/مرزهای کهکشان/);
assert.equal(window.document.querySelector('[data-nav=support]'),null,'Legacy user ticket navigation removed');
assert.ok(!window.document.querySelector('#support-widget').hidden);
const passwordForm=window.document.createElement('form');passwordForm.innerHTML='<input name="password" value="  p۱۲۳ password  "><input name="phone" value="۰۹۱۲۳۴۵۶۷۸۹">';
assert.equal(formObj(passwordForm).password,'  p۱۲۳ password  ');assert.equal(formObj(passwordForm).phone,'09123456789');
navigate('shop');assert.match(window.document.querySelector('#app').textContent,/Auto-pilot Pro/);assert.ok(window.document.querySelector('[data-action=buy-package]'));
navigate('hangar');assert.equal(window.document.querySelectorAll('[data-action=buy-drone]').length,3);assert.equal(window.document.querySelectorAll('[data-action=craft-part]').length,2);
navigate('friends');assert.ok(window.document.querySelector('#friend-request'));assert.ok(window.document.querySelector('.coop-invite'));assert.ok(window.document.querySelector('[name=stage]'));
navigate('admin');state.adminTab='packages';state.adminData=null;app.namespace.render();await flush();
assert.equal(window.document.querySelectorAll('#grant-package').length,1);
assert.equal(window.document.querySelectorAll('#admin-package [name=autopilot] option').length,4);assert.ok(window.document.querySelector('#admin-package [name=auto_shield]'));
await galaxy.action('chat-toggle');await flush();assert.ok(!window.document.querySelector('.chat-panel').hidden);
const chatForm=window.document.querySelector('#support-chat');chatForm.elements.message.value='<script>unsafe</script> پیام آزمایشی';await galaxy.submit(chatForm);await flush();
assert.equal(window.document.querySelectorAll('.chat-bubble').length,1);assert.equal(window.document.querySelectorAll('.chat-bubble script').length,0);assert.match(window.document.querySelector('.chat-bubble').textContent,/<script>unsafe/);
navigate('levels');assert.equal(window.document.querySelectorAll('.boss-level').length,1);
window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({createLinearGradient(){return{addColorStop(){}};}},{get(t,k){return k in t?t[k]:()=>{};},set(t,k,v){t[k]=v;return true;}});
await galaxy.play({id:'44444444-4444-4444-8444-444444444444',stage:1,enemies:8,seed:42,loadout:fixture.loadout});assert.ok(window.document.querySelector('#battle'));assert.ok(window.document.querySelector('[data-action=fullscreen]'));
frames.shift()(performance.now()+16);await galaxy.action('fullscreen');assert.ok(window.document.querySelector('.expanded-game'));await galaxy.leave();assert.equal(state.view,'levels');assert.ok(!window.document.body.classList.contains('fullscreen-fallback'));
galaxy.disconnect();for(const timer of timers)clearTimeout(timer);await window.happyDOM.abort();
console.log('UI QA passed: dashboard, password preservation, package controls, hangar, friends, chat XSS escaping, boss tiles, canvas lifecycle and fullscreen fallback.');
