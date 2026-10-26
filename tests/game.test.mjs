import test from "node:test";
import assert from "node:assert/strict";
import {startShooter} from "../game.js";

function harness(){
 const listeners=new Map(),frames=[],labels=[];
 const ctx=new Proxy({createLinearGradient(){return {addColorStop(){}};},fillText(label){labels.push(label);}},{
  get(target,key){return key in target?target[key]:()=>{};},
  set(target,key,value){target[key]=value;return true;}
 });
 globalThis.window={
  addEventListener(type,fn){listeners.set(type,fn);},
  removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}
 };
 globalThis.document={body:{}};
 const now=globalThis.performance.now();
 globalThis.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
 globalThis.cancelAnimationFrame=()=>{};
 const canvas={
  width:0,height:0,
  getContext:()=>ctx,
  getBoundingClientRect:()=>({left:0,top:0,width:900,height:540}),
  addEventListener(){},
  removeEventListener(){}
 };
 const advance=milliseconds=>{
  const cb=frames.shift();
  assert.equal(typeof cb,"function","Expected an animation frame");
  cb(now+milliseconds);
 };
 return {canvas,advance,labels,listeners};
}

test("game pauses once for held P and unbinds listeners on exit",()=>{
 const h=harness();
 const stop=startShooter(h.canvas,{stage:1,count:8,onProgress(){},onEnd(){}});
 assert.equal(h.canvas.width,900);
 assert.equal(h.canvas.height,540);
 h.listeners.get("keydown")({key:"p",repeat:false,target:document.body,preventDefault(){}});
 h.listeners.get("keydown")({key:"p",repeat:true,target:document.body,preventDefault(){}});
 h.advance(16);
 assert.ok(h.labels.includes("PAUSED"),"Held P must not toggle pause twice");
 h.labels.length=0;
 h.listeners.get("keyup")({key:"p"});
 h.listeners.get("keydown")({key:"p",repeat:false,target:document.body,preventDefault(){}});
 h.advance(32);
 assert.ok(!h.labels.includes("PAUSED"),"Second distinct P press resumes play");
 h.listeners.get("blur")();
 h.labels.length=0;
 h.advance(48);
 assert.ok(h.labels.includes("PAUSED"),"Losing focus pauses the game");
 stop();
 assert.equal(h.listeners.size,0,"Gameplay listeners must be removed");
});
