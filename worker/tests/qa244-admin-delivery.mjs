// QA244: credential-scoped, one-response mail processing, fully simulated.
// No actual consumer, Resend email or production API is contacted.
import worker from "../src/index.js";
import assert from "node:assert/strict";
const base="https://lirep-public-api.vidadecanes-peru.workers.dev";
const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",other="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const response="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const token="header."+("payload".repeat(22))+".signature";
const env={
 SUPABASE_URL:"https://example.supabase.co",
 SUPABASE_PUBLISHABLE_KEY:"fake-publishable",
 SUPABASE_SERVICE_ROLE_KEY:"mock-service-role",
 RESEND_API_KEY:"mock-resend-key",
 SUBMIT_RATE_LIMITER:{async limit(){return {success:true}}}
};
let role="company_admin",orgs=[org],due=true,providerPosts=0,claimCalls=0,completeCalls=0;
const logs=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url);
 if(u.hostname==="example.supabase.co"&&u.pathname.endsWith("/lirep_admin_my_organizations")){
   assert.equal(options.headers.apikey,"fake-publishable");
   assert.equal(options.headers.authorization,"Bearer "+token);
   return Response.json(orgs.map(id=>({id,role})));
 }
 if(u.hostname==="example.supabase.co"&&u.pathname.endsWith("/lirep_admin_response_delivery_claim_one")){
   claimCalls++;
   assert.equal(options.headers.apikey,"mock-service-role");
   const payload=JSON.parse(options.body);
   assert.equal(payload.p_organization_id,org);
   assert.equal(payload.p_response_id,response);
   if(!due)return Response.json(null);
   due=false;
   return Response.json({queue_id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",organization_id:org,response_id:response,
     recipient:"test@example.invalid",public_code:"VIDACANE-LR001-2026-00000001",
     company_name:"Empresa de prueba",body:"Respuesta QA 244 sin envío real"});
 }
 if(u.hostname==="example.supabase.co"&&u.pathname.endsWith("/lirep_admin_response_delivery_complete")){
   completeCalls++;
   const obj=JSON.parse(options.body);
   assert.equal(obj.p_success,true);
   assert.equal(obj.p_provider_message_id,"msg_test_244");
   return Response.json({ok:true,status:"sent"});
 }
 if(u.hostname==="api.resend.com"&&u.pathname==="/emails"){
   providerPosts++;
   assert.equal(options.headers["Idempotency-Key"],"lirep-response-"+response);
   const payload=JSON.parse(options.body);
   assert.equal(payload.to[0],"test@example.invalid");
   assert.match(payload.text,/Respuesta QA 244 sin envío real/);
   return Response.json({id:"msg_test_244"});
 }
 logs.push(u.toString());
 throw Error("Unexpected external request: "+u);
};
const req=(organization=org,{origin="https://lirep.360insol.com",auth=token,method="POST"}={})=>
 new Request(base+"/api/v1/admin/response-delivery/process",{
 method,headers:{"Origin":origin,"Authorization":"Bearer "+auth,"Content-Type":"application/json"},
 body:method==="POST"?JSON.stringify({organization_id:organization,response_id:response}):undefined
});
try{
 const blocked=await worker.fetch(req(org,{origin:"https://example.net"}),env,{});
 assert.equal(blocked.status,403);
 const unauth=await worker.fetch(req(org,{auth:"invalid"}),env,{});
 assert.equal(unauth.status,401);
 role="viewer";
 const viewer=await worker.fetch(req(),env,{});
 assert.equal(viewer.status,403);
 role="company_admin";
 orgs=[other];
 const cross=await worker.fetch(req(),env,{});
 assert.equal(cross.status,403);
 assert.equal(claimCalls,0);
 assert.equal(providerPosts,0);
 orgs=[org];
 const first=await worker.fetch(req(),env,{});
 assert.equal(first.status,200);
 const json=await first.json();
 assert.equal(json.status,"accepted");
 assert.equal(providerPosts,1);
 assert.equal(claimCalls,1);
 assert.equal(completeCalls,1);
 assert.ok(!("recipient" in json)&&!("body" in json));
 const second=await worker.fetch(req(),env,{});
 assert.equal(second.status,200);
 assert.equal((await second.json()).status,"not_pending");
 assert.equal(providerPosts,1,"repeated clicks must not send again");
 assert.equal(claimCalls,2);
 assert.equal(logs.length,0);
 console.log("QA244 PASS | origin/JWT/role/tenant, targeted lock, single Resend idempotency, duplicate-safe repeat");
}finally{globalThis.fetch=originalFetch}
