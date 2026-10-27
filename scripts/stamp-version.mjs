// Every published commit gets a monotonically increasing patch version.
// Galaxy Command v6 starts after the last 5.4 release.
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync,readdirSync} from "node:fs";
const BASELINE_SHA="aada19be786d9cbecdc6382f0dce2c299d54379e";
const count=Number(execFileSync("git",["rev-list","--first-parent","--count",BASELINE_SHA+"..HEAD"],{encoding:"utf8"}).trim());
if(!Number.isSafeInteger(count)||count<0)throw Error("Cannot calculate release version: missing main history.");
const version="6.0."+String(count);
const digits="۰۱۲۳۴۵۶۷۸۹";
const fa=version.replace(/[0-9]/g,d=>digits[Number(d)]);
const path="_site/index.html";
let html=readFileSync(path,"utf8");
const footerPattern=/(ورژن:\s*)[۰-۹0-9]+(?:\.[۰-۹0-9]+){2}/g;
const headerPattern=/(نسخه\s*)[۰-۹0-9]+(?:\.[۰-۹0-9]+){2}/g;
if(!footerPattern.test(html)||!headerPattern.test(html))throw Error("Version markers missing from header/footer.");
html=html.replace(footerPattern,(_m,label)=>label+fa);
html=html.replace(headerPattern,(_m,label)=>label+fa);
html=html.replace(/([?&]v=)[0-9]+(?:\.[0-9]+){2}/g,(_m,label)=>label+version);
writeFileSync(path,html);
// Version every edge of the module graph, including lazy game imports. A new
// app shell must never reuse an incompatible ten-minute-old Pages module.
for(const file of readdirSync("_site").filter(name=>name.endsWith(".js"))){
 const target="_site/"+file;
 const source=readFileSync(target,"utf8");
 const stamped=source.replace(/(\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])(\.\/[^"'?]+\.js)(?:\?[^"']*)?\2/g,(_m,prefix,quote,asset)=>prefix+quote+asset+"?v="+version+quote);
 writeFileSync(target,stamped);
}
writeFileSync("_site/version.json",JSON.stringify({version,commit:execFileSync("git",["rev-parse","--short","HEAD"],{encoding:"utf8"}).trim()})+"\n");
console.log("Space Shooter deployed version:",version);
