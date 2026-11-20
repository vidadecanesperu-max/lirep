// QA231: sólo conciliación ficticia de eventos Resend. Nunca se envían correos.
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env={
  SUPABASE_URL:"https://fake.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY:"test-service-role",
  RESEND_API_KEY:"send-only-key",
  RESEND_READ_API_KEY:"read-only-role-key",
  LIREP_ENABLE_MULTIEMPRESA_EMAIL:"true"
};
const id="5b52f613-149b-4ee9-934b-a9ce1e01b6e3";
const email="recipient@example.com";

async function scenario(lastEvent, recipientMismatch=false){
  const saved=globalThis.fetch,calls=[],requests=[],tasks=[];
  let claimed=false;
  globalThis.fetch=async (url,opts={})=>{
    let u=new URL(url);
    if(u.hostname==="fake.supabase.co"&&u.pathname.startsWith("/rest/v1/rpc/")){
      const rpc=u.pathname.split("/").at(-1);
      const payload=JSON.parse(opts.body||"{}");
      calls.push({rpc,payload});
      if(rpc==="lirep_internal_auto_close_due")return Response.json({ok:true,closed_count:0});
      if(rpc==="lirep_admin_response_delivery_claim"||
         rpc==="lirep_next_pending_receipt_id_multiempresa")return Response.json(null);
      if(rpc==="lirep_admin_response_evidence_claim"){
        if(claimed)return Response.json(null);
        claimed=true;
        return Response.json({evidence_id:id,provider_message_id:"provider-test-123",recipient:email});
      }
      if(rpc==="lirep_admin_response_evidence_complete")return Response.json({ok:true});
      throw Error("Unexpected RPC "+rpc);
    }
    if(u.hostname==="api.resend.com"){
      assert.equal(opts.headers.Authorization,"Bearer read-only-role-key");
      requests.push({method:opts.method||"GET",url:u.pathname});
      assert.equal(opts.method,"GET","must not send new emails");
      assert.equal(u.pathname,"/emails/provider-test-123");
      return Response.json({id:"provider-test-123",to:[recipientMismatch?"wrong@example.com":email],
        last_event:lastEvent});
    }
    throw Error("Unexpected URL "+url);
  };
  try{
    worker.scheduled({},env,{waitUntil(p){tasks.push(p)}});
    await Promise.all(tasks);
    return {calls,requests};
  }finally{globalThis.fetch=saved}
}
const delivered=await scenario("delivered");
assert.equal(delivered.requests.length,1);
assert.equal(delivered.requests[0].method,"GET");
assert.ok(delivered.calls.some(x=>x.rpc==="lirep_admin_response_evidence_complete" &&
 x.payload.p_evidence_id===id && x.payload.p_last_event==="delivered"));
const bounced=await scenario("bounced");
assert.ok(bounced.calls.some(x=>x.rpc==="lirep_admin_response_evidence_complete" &&
 x.payload.p_last_event==="bounced"));
const delayed=await scenario("delivery_delayed");
assert.ok(delayed.calls.some(x=>x.rpc==="lirep_admin_response_evidence_complete" &&
 x.payload.p_last_event==="delivery_delayed"));
const rejected=await scenario("delivered",true);
assert.ok(!rejected.calls.some(x=>x.rpc==="lirep_admin_response_evidence_complete"),
 "must reject recipient mismatch");
console.log("QA231 PASS | delivered / bounced / delayed / recipient mismatch / no resend");
