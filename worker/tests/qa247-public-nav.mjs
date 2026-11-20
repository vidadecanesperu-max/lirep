import assert from "node:assert/strict";
import vm from "node:vm";
import worker from "../src/index.js";

// QA253: la navegación del panel de administración permanece independiente.
const origin="https://lirep-public-api.vidadecanes-peru.workers.dev";
for(const suffix of ["", "&embed=1"]){
 const response=await worker.fetch(new Request(origin+"/libro-de-reclamaciones?public_prefix=VIDACANE"+suffix),{},{});
 assert.equal(response.status,200);
 const html=await response.text();
 for(const id of ["lirep-step-inicio","lirep-step-consumidor","lirep-step-bien","lirep-step-reclamo","lirep-step-informacion","lirep-step-enviar"]){
  assert.equal(html.split('id="'+id+'"').length-1,1,"All public form fields persist: "+id);
 }
 for(const removed of ["lirepFormMenuToggle","lirepFormMenuShade","lirepFormSidebar","lirep-form-nav","lirep-form-menu-toggle","lirep:nav-shell"]){
  assert.ok(!html.includes(removed),"No public menu: "+removed);
 }
 assert.match(html,/name="official_delivery_method"/);
 assert.match(html,/name="document_number"/);
 assert.match(html,/id="submit"/);
 assert.match(html,/class="lirep-public-form-layout"/);
 assert.match(html,/\.lirep-public-form-layout\{display:block/);
 assert.doesNotMatch(html,/Resend|SUPABASE_SERVICE_ROLE_KEY|LIREP_RESPONSE_SCHEDULER_FAILED/);
 if(suffix) assert.match(html,/type:"lirep:resize"/);
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if(match[1].trim()) new vm.Script(match[1]);
}
const invalid=await worker.fetch(new Request(origin+"/libro-de-reclamaciones?public_prefix=BAD"),{},{});
assert.equal(invalid.status,200);
assert.match(await invalid.text(),/PUBLIC_PREFIX_REQUIRED/);
console.log("QA253 WORKER PASS | full-width public form, no public sidebar, preserved form, secure tenant");
