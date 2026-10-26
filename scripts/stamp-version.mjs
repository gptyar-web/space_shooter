// Every published commit gets a monotonically increasing patch version.
// The initial v5.4.2 commit is the first merge after BASELINE_SHA.
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
const BASELINE_SHA="c9e03cf575db36ee8e554159f6159d384e2a4498";
const count=Number(execFileSync("git",["rev-list","--first-parent","--count",BASELINE_SHA+"..HEAD"],{encoding:"utf8"}).trim());
if(!Number.isSafeInteger(count)||count<1)throw Error("Cannot calculate release version: missing main history.");
const version="5.4."+String(2+Math.max(0,count-1));
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
writeFileSync("_site/version.json",JSON.stringify({version,commit:execFileSync("git",["rev-parse","--short","HEAD"],{encoding:"utf8"}).trim()})+"\n");
console.log("Space Shooter deployed version:",version);
