// LIREP QA234 | offline consumer tracking / no PII / token security.
// No production Supabase, consumer, letter or Resend requests.
import assert from "node:assert/strict";
import worker from "../src/index.js";
const origin="https://lirep-public-api.vidadecanes-peru.workers.dev";
const prefix="VIDACANE",code="VIDACANE-LR001-2026-00000001",token="75657d23-997c-46ef-8cec-30f8d7fd89a1";
const env={
  SUPABASE_URL:"https://fake.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY:"mock-service-key",
  SUBMIT_RATE_LIMITER:{async limit(){return {success:true}}}
};
const tracking={code,status:"in_review",submitted_at:"2026-11-10T15:00:00Z",
  due_at:"2026-12-01T23:59:59Z",official_delivery_method:"postal",
  history:[{status:"submitted",at:"2026-11-10T15:00:00Z"},
    {status:"in_review",at:"2026-11-11T15:00:00Z"}],
  communications:[{channel:"postal",status:"sent",sent_at:"2026-11-12T15:00:00Z"}]
};
const calls=[],prior=globalThis.fetch;
globalThis.fetch=async(url,opts={})=>{
 const u=new URL(url);
 if(u.host!=="fake.supabase.co"||u.pathname!=="/rest/v1/rpc/lirep_public_case_tracking")
  throw Error("Unexpected request "+url);
 const body=JSON.parse(opts.body);
 calls.push(body);
 assert.equal(body.p_public_prefix,prefix);
 assert.equal(body.p_public_code,code);
 return Response.json(body.p_access_token===token?tracking:null);
};
const get=async(path)=>worker.fetch(new Request(origin+path),env,{waitUntil(){}});
try {
  const html=await get("/seguimiento?public_prefix="+prefix+"&code="+code+"&token="+token);
  assert.equal(html.status,200);
  assert.equal(html.headers.get("cache-control"),"no-store, private");
  assert.equal(html.headers.get("referrer-policy"),"no-referrer");
  const content=await html.text();
  assert.match(content,/Seguimiento de reclamación/);
  assert.match(content,/Carta física/);
  assert.match(content,/Carta despachada/);
  assert.doesNotMatch(content,/<script|consumer@example.com|999999999|Nota interna/i);
  const json=await get("/api/v1/tracking?public_prefix="+prefix+"&code="+code+"&token="+token);
  assert.equal(json.status,200);
  const payload=await json.json();
  assert.equal(payload.tracking.status,"in_review");
  assert.equal(payload.tracking.official_delivery_method,"postal");
  assert.equal(payload.tracking.communications[0].status,"sent");
  assert.ok(!("consumer" in payload.tracking));
  const denied=await get("/seguimiento?public_prefix="+prefix+"&code="+code+"&token=00000000-0000-4000-8000-000000000001");
  assert.equal(denied.status,404);
  const invalid=await get("/seguimiento?public_prefix="+prefix+"&code="+code+"&token=bad");
  assert.equal(invalid.status,400);
  assert.equal(calls.length,3);
  const form=await get("/libro-de-reclamaciones?public_prefix="+prefix);
  const formHtml=await form.text();
  assert.match(formHtml,/name="official_delivery_method"/);
  assert.match(formHtml,/value="postal"/);
  assert.match(formHtml,/id="trackingButton"/);
  assert.match(formHtml,/name="email"[^>]*required/);
  assert.match(formHtml,/value="whatsapp"/);
  console.log("QA234 PASS | private-token tracking, invalid access, no PII, letter and email options, no external messages");
}finally{globalThis.fetch=prior}
