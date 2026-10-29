import fs from "node:fs";
import assert from "node:assert/strict";
const a1=fs.readFileSync("supabase/migrations/20261028223000_lirep_admin_a1_readonly_tenants.sql","utf8");
const a2=fs.readFileSync("supabase/migrations/20261028233000_lirep_admin_a2_owner_governance.sql","utf8");
const ui=fs.readFileSync("admin/index.html","utf8");
const config=fs.readFileSync("admin/config.example.js","utf8");
const bootstrap=fs.readFileSync("admin/OWNER-BOOTSTRAP-MANUAL.sql","utf8");
for (const name of ["lirep_admin_my_organizations","lirep_admin_list_complaints"]){
 assert(a1.includes(name) && a2.includes(name), "RPC missing "+name);
}
for(const name of ["lirep_admin_is_owner","lirep_admin_owner_memberships","lirep_admin_owner_set_membership"]){
 assert(a2.includes(name), "Owner RPC missing "+name);
}
assert(a2.includes("auth.uid()") && a1.includes("auth.uid()"), "JWT identity check missing");
assert(a2.includes("ACCESS_DENIED") && a1.includes("ACCESS_DENIED"), "Authorization refusal missing");
assert(a2.includes("public.lirep_admin_access_audit") && a2.includes("insert into public.lirep_admin_access_audit"), "Audit missing");
assert(a2.includes("lower(u.email)=lower(btrim(p_user_email))") && a2.includes("u.email_confirmed_at is not null"), "Verified user lookup missing");
assert(ui.includes("lirep_admin_owner_set_membership") && ui.includes("lirep_admin_owner_memberships"), "Owner UI missing");
assert(ui.includes("textContent=x") && ui.includes("td.textContent=value"), "Safe text rendering missing");
assert(!ui.includes("service_role") && ui.includes("rememberSession?localStorage:sessionStorage"), "Unsafe admin frontend");
assert(!config.includes("sb_secret_") && !/publishableKey:\\s*["\x27](?:eyJ|sb_secret_)/.test(config), "Unsafe frontend config");
assert(bootstrap.includes("REEMPLAZAR_CON_EMAIL_VERIFICADO"), "Owner must be explicit");
const a6=fs.readFileSync("supabase/migrations/20261029011500_lirep_admin_a6_case_detail_drafts.sql","utf8");
for(const name of ["lirep_admin_case_detail","lirep_admin_case_entries_list","lirep_admin_case_add_entry","lirep_admin_can_access"]){
 assert(a6.includes(name), "A6 RPC missing "+name);
}
assert(a6.includes("organization_id=p_organization_id") && a6.includes("AUTH")===false, "A6 organization guard missing");
assert(a6.includes("ACCESS_DENIED") && a6.includes("auth.uid()"),"A6 authorization check missing");
assert(a6.includes("'saved_internal_only'") && !a6.includes("api.resend.com"),"A6 must not claim to deliver replies");
assert(ui.includes("lirep_admin_case_detail") && ui.includes("lirep_admin_case_add_entry"),"A6 UI missing");
assert(ui.includes("target.setItem(storageKey") && ui.includes("grant_type=refresh_token"),"Session resume/rotation missing");
assert(ui.includes("sessionStorage.removeItem(storageKey)") && ui.includes("await enterWorkspace();"),"Session logout/restore missing");
assert(ui.includes("td.dataset.label") && ui.includes("grid-template-columns:minmax(0,1fr)"),"Mobile table card layout missing");
assert(ui.includes('id="rememberSession"') && ui.includes("rememberMaxSeconds=7*24*60*60"),"Opt-in remember me missing");
assert(ui.includes("rememberSession?localStorage:sessionStorage") && ui.includes("localStorage.removeItem(storageKey)"),"Opt-in persistence or cleanup missing");
assert(ui.includes('id="notificationPanel"') && ui.includes("lirep_admin_a9_settings"),"A9 notification panel missing");
assert(ui.includes("p_enabled:false") && ui.includes("lirep_admin_a9_delivery_status"),"A9 disabled-by-default settings/status missing");
console.log("PASS LIREP ADMIN A1-A9 interface contract");
