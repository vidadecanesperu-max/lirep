import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const page=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const script=page.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]?.trimStart().replace(/^import[^\n]+\n/,"");
assert.ok(script);
new vm.Script(script);
for(const s of ["id=\"paperDeliveryForm\"","id=\"caseTrackingPanel\"","id=\"caseTrackingTimeline\"","data-print","data-paper","lirep_admin_record_paper_delivery","lirep_admin_case_tracking","lirep_admin_case_status_update","r.submitted_by===currentUserId?'Aprobar mi respuesta'"]){
 assert.ok(page.includes(s),"Missing QA234 admin UI: "+s);
}
assert.ok(!page.includes("r.submitted_by!==currentUserId"),"Self-approval restriction remains in UI");
const sql=fs.readFileSync(new URL("../../supabase/migrations/20261119170000_lirep_qa234_self_approval_official_delivery.sql",import.meta.url),"utf8");
const sqlTracking=fs.readFileSync(new URL("../../supabase/migrations/20261119171000_lirep_qa234_postal_evidence_tracking.sql",import.meta.url),"utf8");
assert.ok(sql.includes("drop constraint lirep_a10_distinct_reviewer"));
assert.ok(sql.includes("Autoaprobación por administrador autorizado"));
assert.ok(!sql.includes("SELF_APPROVAL_FORBIDDEN"));
assert.ok(sql.includes("LIREP_SUBMISSION_ACCESS_DENIED"));
assert.ok(sqlTracking.includes("p_access_token"));
assert.ok(sqlTracking.includes("LIREP_TRACKING_ACCESS_DENIED"));
assert.ok(sqlTracking.includes("p_reference"));
assert.ok(sqlTracking.includes("LIREP_PAPER_PROOF_REFERENCE_REQUIRED"));
console.log("QA234 PASS | self-review backend guard, audit, postal evidence, tracking auth, admin controls");
