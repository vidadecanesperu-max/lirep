import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const page=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const script=page.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]?.trimStart().replace(/^import[^\n]+\n/,"");
assert.ok(script);new vm.Script(script);
for(const id of ["lirepNavToggle","lirepNavShade","lirepSidebar","introPanel","summaryPanel",
"complaintsPanel","detailPanel","formalResponsePanel","history","membersPanel"]){
 assert.match(page,new RegExp('id="'+id+'"'));
}
assert.match(page,/aria-controls="lirepSidebar" aria-expanded="false"/);
for(const section of ["introPanel","summaryPanel","complaintsPanel","detailPanel","formalResponsePanel","history","membersPanel"]){
 assert.match(page,new RegExp('data-section="'+section+'"'));
}
assert.match(page,/@media\(max-width:900px\)/);
assert.match(page,/#dashboard \.lirep-sidebar\[data-open="true"\]/);
assert.match(script,/function openSidebar\(\)/);
assert.match(script,/function closeSidebar\(\)/);
assert.match(script,/event\.key==='Escape'/);
assert.match(script,/event\.key!=='Tab'/);
assert.match(script,/event\.shiftKey/);
assert.match(script,/updateCaseNavigation\(\)/);
assert.match(script,/target\.scrollIntoView\?\./);
assert.doesNotMatch(script,/window\.location\.assign\(/);
assert.match(page,/Información técnica · solo administración/);
assert.match(page,/Última verificación:/);
assert.doesNotMatch(page,/Última consulta registrada en Resend|Referencia Resend:|Aceptado por Resend/);
console.log("QA247 ADMIN PASS | sidebar, mobile drawer, focus, tenant-safe navigation and internal-only technical details");
