// QA235 | Modal personalizado y corrección SQL (solo lectura, sin acciones reales).
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]?.trimStart().replace(/^import[^\n]+\n/,"");
assert.ok(script,"Admin module found");
new vm.Script(script,{filename:"admin/index.html"});
assert.match(html,/id="lirepDialogBackdrop"/);
assert.match(html,/role="dialog" aria-modal="true"/);
assert.match(html,/aria-labelledby="lirepDialogTitle" aria-describedby="lirepDialogText"/);
assert.match(html,/id="lirepDialogReason"/);
assert.match(html,/id="lirepDialogCancel"/);
assert.match(html,/id="lirepDialogAccept"/);
assert.match(html,/id="lirepDialogError" role="alert"/);
assert.match(html,/event\.key==='Escape'/);
assert.match(html,/event\.key!=='Tab'/);
assert.match(html,/current\.previouslyFocused\?\.focus/);
assert.match(html,/lirepDialogReason'\)\.value\.trim\(\)/);
assert.match(html,/note\.length<3/);
assert.match(html,/function lirepDialog\(/);
assert.match(html,/async function lirepConfirm\(/);
assert.doesNotMatch(script,/\b(?:confirm|prompt|alert)\s*\(/i,"No native Chrome modal may remain");
assert.match(html,/Aprobar y enviar/);
assert.match(html,/Rechazar respuesta propuesta/);
assert.match(html,/Descartar texto sin guardar/);
assert.match(html,/Registrar comunicación por carta/);
assert.match(html,/Cambiar estado del reclamo/);

const sql=fs.readFileSync(new URL("../../supabase/migrations/20261119191000_lirep_qa235_fix_queue_consumer_minor.sql",import.meta.url),"utf8");
assert.match(sql,/case when co\.is_minor then co\.representative_email else co\.email end/g);
assert.doesNotMatch(sql,/case when c\.is_minor/i,"is_minor belongs to consumers, never complaints");
assert.match(sql,/new\.status='approved' and old\.status='pending_approval'/);
assert.match(sql,/on conflict\(response_id\) do nothing/,"Existing anti-duplicate protection preserved");
console.log("QA235 PASS | all native confirms eliminated, accessible modal, reason validation, SQL alias, duplicate protection");
