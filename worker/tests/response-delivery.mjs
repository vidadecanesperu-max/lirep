// QA230: la entrega oficial NO usa reclamaciones reales ni envía correos.
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = {
  SUPABASE_URL: "https://fake.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "mock-service-role",
  RESEND_API_KEY: "mock-resend",
  LIREP_ENABLE_MULTIEMPRESA_EMAIL: "true"
};
const queueId="c1717877-b10a-43d5-8a04-baceb9ef9711";
const responseId="f9accb15-f9e2-4a4c-a9bd-94b732866fe0";
const job={
  queue_id:queueId,response_id:responseId,
  recipient:"consumer@example.com",
  company_name:"Empresa <Test>",
  public_code:"A1B2C3D4-LR2026-001",
  body:"Se acepta <su pedido>.\nAdjuntamos el resultado."
};

async function testScenario(providerStatus=200) {
  const calls=[],mail=[],tasks=[];
  let claimed=false;
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,opts={})=>{
    const u=new URL(url);
    if(u.hostname==="fake.supabase.co"&&u.pathname.startsWith("/rest/v1/rpc/")){
      const rpc=u.pathname.split("/").at(-1);
      const body=JSON.parse(opts.body||"{}");
      calls.push({rpc,body});
      if(rpc==="lirep_admin_response_evidence_claim")return Response.json(null);
      if(rpc==="lirep_internal_auto_close_due")return Response.json({ok:true,closed_count:0});
      if(rpc==="lirep_admin_response_delivery_claim"){
        if(claimed)return Response.json(null);
        claimed=true;return Response.json(job);
      }
      if(rpc==="lirep_next_pending_receipt_id_multiempresa")return Response.json(null);
      if(rpc==="lirep_admin_response_delivery_complete")return Response.json({ok:true});
      throw new Error("Unexpected RPC: "+rpc);
    }
    if(u.hostname==="api.resend.com"&&u.pathname==="/emails"){
      mail.push({headers:opts.headers,body:JSON.parse(opts.body)});
      return Response.json(providerStatus===200?{id:"provider-test-001"}:{message:"mock error"},
        {status:providerStatus});
    }
    throw new Error("Unexpected outgoing request: "+url);
  };
  try {
    worker.scheduled({},env,{waitUntil(p){tasks.push(p)}});
    await Promise.all(tasks);
    return {calls,mail};
  } finally {globalThis.fetch=previous}
}

const accepted=await testScenario(200);
assert.equal(accepted.mail.length,1,"one and only one email");
assert.equal(accepted.mail[0].headers["Idempotency-Key"],"lirep-response-"+responseId);
assert.equal(accepted.mail[0].body.to[0],"consumer@example.com");
assert.ok(accepted.mail[0].body.html.includes("&lt;su pedido&gt;"));
assert.match(accepted.mail[0].body.html, /LIREP/);
assert.match(accepted.mail[0].body.html, /#142640/);
assert.match(accepted.mail[0].body.html, /#f3f6fa/);
assert.match(accepted.mail[0].body.html, /360 Integral Solutions/);
assert.match(accepted.mail[0].body.html, /15 días calendario/);
assert.match(accepted.mail[0].body.html, /Libro de Reclamaciones Virtual/);
assert.match(accepted.mail[0].body.text, /15 días calendario/);
assert.ok(accepted.calls.some(c=>c.rpc==="lirep_internal_auto_close_due"));
assert.ok(!accepted.mail[0].body.html.includes("<su pedido>"));
assert.ok(accepted.calls.some(c=>c.rpc==="lirep_admin_response_delivery_complete"&&
  c.body.p_success===true&&c.body.p_provider_message_id==="provider-test-001"));
const limited=await testScenario(429);
assert.ok(limited.calls.some(c=>c.rpc==="lirep_admin_response_delivery_complete"&&
  c.body.p_success===false&&c.body.p_retryable===true));
const permanent=await testScenario(400);
assert.ok(permanent.calls.some(c=>c.rpc==="lirep_admin_response_delivery_complete"&&
  c.body.p_success===false&&c.body.p_retryable===false));
console.log("QA230 PASS | accepted / rate-limit / permanent-error / HTML escaping / idempotency");
