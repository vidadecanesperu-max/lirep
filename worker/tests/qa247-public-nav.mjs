import assert from "node:assert/strict";
import vm from "node:vm";
import worker from "../src/index.js";
const origin="https://lirep-public-api.vidadecanes-peru.workers.dev";
const env={};
for(const query of ["","&embed=1"]){
 const response=await worker.fetch(new Request(origin+"/libro-de-reclamaciones?public_prefix=VIDACANE"+query),env,{});
 assert.equal(response.status,200);
 const html=await response.text();
 for(const id of ["lirepFormMenuToggle","lirepFormMenuShade","lirepFormSidebar",
 "lirep-step-inicio","lirep-step-consumidor","lirep-step-bien","lirep-step-reclamo",
 "lirep-step-informacion","lirep-step-enviar"]){
  assert.equal(html.split('id="'+id+'"').length-1,1,"Public form section exists exactly once "+id);
 }
 assert.match(html,/aria-expanded="false"/);
 assert.match(html,/@media\(max-width:900px\)/);
 assert.match(html,/window\.parent\.postMessage\(\{type:"lirep:section"/);
 assert.match(html,/event\.source!==window\.parent/);
 assert.match(html,/event\.data\.type==="lirep:nav-shell"/);
 assert.match(html,/event\.data\.type==="lirep:navigate"/);
 assert.match(html,/lirep-has-parent-nav/);
 assert.match(html,/data-lirep-go="enviar"/);
 assert.match(html,/name="official_delivery_method"/);
 assert.doesNotMatch(html,/Resend|SUPABASE_SERVICE_ROLE_KEY|LIREP_RESPONSE_SCHEDULER_FAILED/);
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){
  if(m[1].trim())new vm.Script(m[1]);
 }
}
const bad=await worker.fetch(new Request(origin+"/libro-de-reclamaciones?public_prefix=BAD"),env,{});
assert.equal(bad.status,200,"Keep public fail-closed page rather than exposing a new route");
assert.match(await bad.text(),/PUBLIC_PREFIX_REQUIRED/);
console.log("QA247 WORKER PASS | standalone/embed hamburger, safe tenant navigation, no technical provider exposure");
