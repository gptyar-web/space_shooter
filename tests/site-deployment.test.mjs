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
 const initial=[...html.matchAll(/(?:src|href)=["'](\.\/[^"'?]+\.(?:js|css))(?:\?[^"']*)?["']/g)].map(x=>x[1]);
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


test("deployed header, footer and version manifest agree",()=>{
 const html=required("index.html");
 const release=JSON.parse(required("version.json"));
 assert.match(release.version,/^\d+\.\d+\.\d+$/);
 const fa=release.version.replace(/\d/g,d=>"۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
 assert.ok(html.includes("ورژن: "+fa),"Footer version must match the release manifest");
 assert.ok(html.includes("نسخه "+fa),"Header version must match the release manifest");
 assert.ok(html.includes("./app.js?v="+release.version),"App JS must carry the current cache-busting version");
 assert.ok(html.includes("./theme-v5.css?v="+release.version),"Theme stylesheet must carry the current version");
});
