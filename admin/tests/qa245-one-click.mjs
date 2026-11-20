// LIREP QA245 - one click answer: static security and UI invariant checks.
// Only local files; no Supabase, Resend, customer, or production calls.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const js=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]?.trimStart().replace(/^import[^\n]+\n/,"");
assert.ok(js);
new vm.Script(js);
assert.match(html,/Respuesta y seguimiento del expediente/);
assert.match(html,/Responder y enviar/);
assert.match(js,/adminCanSend/);
assert.match(js,/Aprobar y enviar/);
assert.match(js,/Enviar respuesta ahora/);
assert.match(js,/lirep_admin_reply_and_approve/);
assert.match(js,/sendApprovedResponse\(orgId,answer\.response_id\)/);
assert.match(js,/if\(caseTracking\?\.official_delivery_method!=='postal'\)/);
assert.match(js,/data-process/);
assert.match(js,/button\.disabled=true/);
assert.doesNotMatch(js,/title:'Procesar correo oficial pendiente'/);
assert.doesNotMatch(js,/\b(?:confirm|prompt|alert)\s*\(/);
const migration=fs.readFileSync(new URL("../../supabase/migrations/20261119205100_lirep_qa245_one_click_reply.sql",import.meta.url),"utf8");
assert.match(migration,/lirep_admin_reply_and_approve/);
assert.match(migration,/FOR UPDATE OF c/);
assert.match(migration,/LIREP_OFFICIAL_RESPONSE_ALREADY_EXISTS/);
assert.match(migration,/lirep_admin_case_add_entry/);
assert.match(migration,/lirep_admin_a10_submit/);
assert.match(migration,/lirep_admin_a10_review/);
assert.match(migration,/REVOKE ALL ON FUNCTION public\.lirep_admin_reply_and_approve/);
assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.lirep_admin_reply_and_approve[\s\S]*TO authenticated/);
const service=fs.readFileSync(new URL("../../supabase/migrations/20261119205000_lirep_qa245_service_permissions.sql",import.meta.url),"utf8");
for(const name of ["lirep_admin_response_delivery_claim","lirep_admin_response_delivery_claim_one","lirep_admin_response_delivery_complete","lirep_admin_response_evidence_claim","lirep_admin_response_evidence_complete","lirep_public_case_tracking","lirep_submit_public_complaint_gateway"]){
 assert.match(service,new RegExp("REVOKE ALL ON FUNCTION public\\."+name+"\\("));
 assert.match(service,new RegExp("GRANT EXECUTE ON FUNCTION public\\."+name+"\\("));
}
assert.ok(!/if\s+coalesce\s*\(\s*current_setting\s*\(\s*'request\.jwt\.claim\.role'/i.test(service));
console.log("QA245 PASS | one click answer, tenant permissions, idempotence, no native confirm");
