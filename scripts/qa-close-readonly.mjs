#!/usr/bin/env node
/**
 * LIREP QA: backend, receipt access controls and production presentation.
 * Read-only GET requests only. No complaint creation, email or database mutation.
 * Usage: node scripts/qa-close-readonly.mjs 9DC4C4F0
 */
const prefix = String(process.argv[2] || '').trim().toUpperCase();
const origin = 'https://lirep-public-api.vidadecanes-peru.workers.dev';
if (!/^[A-Z0-9]{8}$/.test(prefix)) { console.error('Uso: node qa-close-readonly.mjs PREFIJO_DE_8_CARACTERES'); process.exit(2); }
let failed=0;
const check=(ok,label)=>{console.log((ok?'PASS':'FAIL')+' | '+label);if(!ok)failed++;};
async function get(path){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try {return await fetch(origin+path,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:'application/json,text/html'}});}
  finally{clearTimeout(timeout);}
}
try {
  const health=await get('/health');
  const status=await health.json();
  check(health.status===200&&status.ok===true&&status.service==='lirep-public-api','Worker health and service identity');
  const backend=await get('/health/backend');
  const backendBody=await backend.json();
  check(backend.status===200&&backendBody.ok===true&&backendBody.connected===true,'Supabase backend connectivity');
  const receipt=await get('/constancia?public_prefix='+encodeURIComponent(prefix));
  const receiptBody=await receipt.json();
  check(receipt.status===400&&receiptBody.ok===false,'Receipt without code and token rejected');
  const fakeCode='QA-INVALID-00000000';
  const fakeToken='qa-invalid-token';
  const fake=await get('/constancia?public_prefix='+encodeURIComponent(prefix)+'&code='+encodeURIComponent(fakeCode)+'&token='+encodeURIComponent(fakeToken));
  check(fake.status!==200,'Receipt with invalid credentials not disclosed');
  const page=await get('/libro-de-reclamaciones?public_prefix='+encodeURIComponent(prefix)+'&embed=1');
  const html=await page.text();
  // Company name is inserted by loadConfig() after the static HTML loads.
  // Verify the tenant configuration and the client-side rendering contract separately.
  const configResponse=await get('/api/v1/form-config?public_prefix='+encodeURIComponent(prefix));
  const configBody=await configResponse.json();
  const org=configBody?.config?.organization;
  const companyName=String(org?.trade_name||org?.legal_name||'').trim();
  check(configResponse.status===200&&configBody.ok===true&&Boolean(org),'Tenant configuration resolved for prefix');
  check(companyName.length>0,'Tenant organization has a display name');
  check(page.status===200&&/async function loadConfig\(\)/.test(html)&&/\/api\/v1\/form-config/.test(html),'Public HTML loads tenant identity dynamically');
  check(!/SUPABASE_SERVICE_ROLE_KEY|TURNSTILE_SECRET|RESEND_API_KEY/.test(html),'No server secret identifiers in public HTML');
  check(/<meta[^>]+viewport/i.test(html),'Responsive viewport present');
  console.log('READ ONLY | GET only; no complaint, email, or database write');
} catch(e){failed++;console.error('FAIL | '+String(e?.message||e));}
console.log('LIREP CIERRE | '+(failed?'OBSERVACIONES '+failed:'QA SEGURIDAD PASS'));
process.exitCode=failed?1:0;
