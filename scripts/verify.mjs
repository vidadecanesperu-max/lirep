import fs from 'node:fs';

const required=[
  'README.md','VERSION','package.json','app/index.html',
  'worker/src/index.js','wordpress/lirep/lirep.php','supabase/migrations/README.md'
];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error('Missing:',missing.join(', '));process.exit(1)}

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const version=fs.readFileSync('VERSION','utf8').trim();
if(pkg.version!==version){console.error('Version mismatch');process.exit(1)}

const worker=fs.readFileSync('worker/src/index.js','utf8');
const app=fs.readFileSync('app/index.html','utf8');
const plugin=fs.readFileSync('wordpress/lirep/lirep.php','utf8');
const workerConfig=JSON.parse(fs.readFileSync('worker/wrangler.jsonc','utf8'));
const approvedEmail=workerConfig.vars?.LIREP_APPROVED_FROM_EMAIL;
const sends=worker.match(/fetch\("https:\/\/api\.resend\.com\/emails"/g)||[];
const senderGuards=worker.match(/approvedReceiptSender\(job\.from_email, env\)/g)||[];
if(workerConfig.vars?.LIREP_ENABLE_MULTIEMPRESA_EMAIL!=="true"||approvedEmail!=="lirep@mail.vidadecanes.pe"||sends.length!==2||senderGuards.length!==2){console.error('SENDER APPROVAL SAFETY FAIL');process.exit(1);}


const forbidden=[
  ['worker hardcoded tenant', worker, 'const PREFIX=\\\"VIDACANE\\\"'],
  ['app hardcoded tenant', app, 'const PREFIX="VIDACANE"']
];
for(const [name,body,needle] of forbidden){
  if(body.includes(needle)){console.error('SECURITY FAIL:',name);process.exit(1)}
}
for(const [name,body,needle] of [
  ['worker fail closed',worker,'PUBLIC_PREFIX_REQUIRED'],
  ['app fail closed',app,'PUBLIC_PREFIX_REQUIRED'],
  ['worker tenant header',worker,'X-LIREP-Prefix'],
  ['plugin tenant setting',plugin,'lirep_public_prefix']
]){
  if(!body.includes(needle)){console.error('SECURITY FAIL:',name);process.exit(1)}
}
// Email rollout safeguards: both paths must remain QA-only until approved.
const emailStart=worker.indexOf('async function sendSecureReceipt(');
const emailEnd=worker.indexOf('\nasync function ',emailStart+10);
const emailFunction=worker.slice(emailStart,emailEnd<0?undefined:emailEnd);
const scheduledStart=worker.indexOf('async scheduled(');
const scheduledEnd=worker.indexOf('async fetch(',scheduledStart);
const scheduledFunction=worker.slice(scheduledStart,scheduledEnd<0?undefined:scheduledEnd);
const schedulerSql=fs.readFileSync('supabase/migrations/20261008011500_v1_13_6_receipt_queue_scheduler.sql','utf8');
const multiempresaSchedulerSql=fs.readFileSync('supabase/migrations/20261028193000_v1_13_12_multiempresa_receipt_retry_opt_in.sql','utf8');
const completionSql=fs.readFileSync('supabase/migrations/20261008015000_v1_13_7_evidence_schema_fix_and_qa_reconciliation.sql','utf8');
for(const [name,passed] of [
 ['immediate multiempresa opt-in gate',emailFunction.includes('prefix !== "LIREPQA1" && env.LIREP_ENABLE_MULTIEMPRESA_EMAIL !== "true"')],
 ['scheduled QA-only database discovery',schedulerSql.includes("o.public_prefix='LIREPQA1'")],
 ['scheduled opt-in RPC selector',scheduledFunction.includes('LIREP_ENABLE_MULTIEMPRESA_EMAIL === "true"') && scheduledFunction.includes('lirep_next_pending_receipt_id_multiempresa')],
 ['multiempresa retry discovery excludes unavailable senders',multiempresaSchedulerSql.includes('s.is_active = true') && multiempresaSchedulerSql.includes('s.from_email IS NOT NULL')],
 ['multiempresa retry discovery service role only',multiempresaSchedulerSql.includes('TO service_role') && multiempresaSchedulerSql.includes('FROM PUBLIC, anon, authenticated')],
 ['immediate accepted-email retry guard',emailFunction.includes('if (accepted)')],
 ['scheduled accepted-email retry guard',scheduledFunction.includes('if (accepted)')],
 ['email evidence destination schema',completionSql.includes('external_message_id')&&completionSql.includes('destination')],
 ['receipt token best-effort',worker.includes('RECEIPT_TOKEN_ISSUANCE_FAILED')]
]) { if(!passed){console.error('EMAIL SAFETY FAIL:',name);process.exit(1)} }
const pluginTenantFunction=plugin.slice(plugin.indexOf('function lirep_shortcode('));
for(const [name,passed] of [
 ['WordPress administrator-controlled tenant',pluginTenantFunction.includes("get_option('lirep_public_prefix'")],
 ['WordPress no shortcode tenant override',!pluginTenantFunction.includes("$atts['prefix']")],
 ['WordPress iframe no-referrer',pluginTenantFunction.includes('referrerpolicy="no-referrer"')]
]) { if(!passed){console.error('WORDPRESS SECURITY FAIL:',name);process.exit(1)} }
for(const [name,passed] of [
 ['WordPress exact tenant validation',plugin.includes("preg_match('/^[A-Z0-9]{8}$/', $prefix)")],
 ['WordPress invalid tenant retains previous setting',plugin.includes("get_option('lirep_public_prefix', '')")],
 ['WordPress settings validation feedback',plugin.includes("settings_errors('lirep_public_prefix')")]
]) { if(!passed){console.error('WORDPRESS CONFIG FAIL:',name);process.exit(1)} }
for(const [name,passed] of [
 ['Worker iframe resize protocol',worker.includes('lirep:resize')],
 ['Worker embedded-only resize',worker.includes('get("embed")!=="1"')],
 ['WordPress iframe resize listener',plugin.includes('lirep:resize')],
 ['WordPress iframe message origin guard',plugin.includes('event.origin!==origin')],
 ['WordPress iframe message source guard',plugin.includes('event.source!==frame.contentWindow')],
 ['WordPress iframe tenant guard',plugin.includes('data.prefix!==prefix')]
]){if(!passed){console.error('IFRAME RESIZE FAIL:',name);process.exit(1)}}
console.log('WordPress tenant and referrer safeguards OK');
console.log('Email rollout safety guards OK');

console.log(`LIREP ${version} verification OK`);
console.log('Tenant isolation guards OK');
