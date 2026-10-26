import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {resolve,join,dirname,sep} from "node:path";

const root=resolve(process.cwd(),"_site");
function required(path){
 const location=resolve(root,path);
 assert.ok(location.startsWith(root+sep),"Only local deployment assets are allowed: "+path);
 assert.ok(existsSync(location),"Missing GitHub Pages asset: "+path);
 const source=readFileSync(location,"utf8");
 assert.ok(source.trim().length>0,"Empty deployment asset: "+path);
 return source;
}

test("published HTML and recursive JavaScript imports exist in deployment artifact",()=>{
 const html=required("index.html");
 const initial=[...html.matchAll(/(?:src|href)=["'](\.\/[^"']+\.(?:js|css))["']/g)].map(x=>x[1]);
 assert.ok(initial.includes("./app.js"),"Main module must be shipped");
 const stack=initial.map(s=>s.slice(2)),visited=new Set();
 while(stack.length){
  const path=stack.pop();
  if(visited.has(path))continue;
  visited.add(path);
  const source=required(path);
  if(!path.endsWith(".js"))continue;
  for(const m of source.matchAll(/\bfrom\s*["'](\.\/[^"']+\.js)["']|\bimport\s*["'](\.\/[^"']+\.js)["']/g)){
   const child=m[1]||m[2];
   stack.push(join(dirname(path),child));
  }
 }
 assert.ok(visited.has("jalali-calendar.js"),"Jalali calendar dependency must be deployed");
});
