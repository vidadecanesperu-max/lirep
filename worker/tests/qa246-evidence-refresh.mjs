// QA246 | Live status check for an existing Resend message. Every API mocked.
import worker from "../src/index.js";
import assert from "node:assert/strict";
const base="https://lirep-public-api.vidadecanes-peru.workers.dev";
const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",other="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const response="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const token="header."+("payload".repeat(22))+".signature";
const email="test@example.invalid",message="msg_qa246";
let role="company_admin",orgs=[org],due=true,postEmails=0,providerReads=0,claims=0,completes=0;
const env={SUPABASE_URL:"https://example.supabase.co",SUPABASE_PUBLISHABLE_KEY:"mock-public",
  SUPABASE_SERVICE_ROLE_KEY:"mock-service",RESEND_API_KEY:"mock-resend",
  SUBMIT_RATE_LIMITER:{async limit(){return {success:true}}}};
const original=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url),method=options.method||"GET";
 if(u.hostname==="example.supabase.co"&&u.pathname.endsWith("/lirep_admin_my_organizations")){
   assert.equal(options.headers.authorization,"Bearer "+token);
   assert.equal(options.headers.apikey,"mock-public");
   return Response.json(orgs.map(id=>({id,role})));
 }
 if(u.hostname==="example.supabase.co"&&u.pathname.endsWith("/lirep_admin_response_evidence_claim_one")){
   assert.equal(options.headers.apikey,"mock-service");
   assert.equal(options.headers.Authorization,"Bearer mock-service");
   const payload=JSON.parse(options.body);
   assert.deepEqual(payload,{p_organization_id:org,p_response_id:response});
   claims++;
   if(!due)return Response.json(null);
   due=false;
   return Response.json({evidence_id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
     response_id:response,provider_message_id:message,recipient:email});
 }
 if(u.hostname==="example.supabase.co"&&u.pathname.endsWith("/lirep_admin_response_evidence_complete")){
   assert.equal(options.headers.apikey,"mock-service");
   const payload=JSON.parse(options.body);
   assert.equal(payload.p_provider_message_id,message);
   assert.equal(payload.p_last_event,"delivered");
   completes++;
   return Response.json({ok:true});
 }
 if(u.hostname==="api.resend.com"&&u.pathname.endsWith("/"+message)){
   assert.equal(method,"GET");
   providerReads++;
   return Response.json({id:message,to:[email],last_event:"delivered"});
 }
 if(u.hostname==="api.resend.com"&&method==="POST"){postEmails++;throw Error("New email prohibited");}
 throw Error("Unexpected request "+u+" "+method);
};
const req=(organization=org,{origin="https://lirep.360insol.com",auth=token}={})=>
 new Request(base+"/api/v1/admin/response-delivery/refresh",{method:"POST",
 headers:{Origin:origin,Authorization:"Bearer "+auth,"Content-Type":"application/json"},
 body:JSON.stringify({organization_id:organization,response_id:response})});
try{
 const invalid=await worker.fetch(req(org,{origin:"https://evil.invalid"}),env,{});
 assert.equal(invalid.status,403);
 const unsigned=await worker.fetch(req(org,{auth:"bad"}),env,{});
 assert.equal(unsigned.status,401);
 role="viewer";
 assert.equal((await worker.fetch(req(),env,{})).status,403);
 role="company_admin";orgs=[other];
 assert.equal((await worker.fetch(req(),env,{})).status,403);
 assert.equal(claims,0);assert.equal(providerReads,0);
 orgs=[org];
 const first=await worker.fetch(req(),env,{});
 assert.equal(first.status,200);
 assert.deepEqual(await first.json(),{ok:true,status:"checked",event:"delivered"});
 assert.equal(providerReads,1);assert.equal(claims,1);assert.equal(completes,1);
 const second=await worker.fetch(req(),env,{});
 assert.equal(second.status,200);
 assert.equal((await second.json()).status,"not_due");
 assert.equal(providerReads,1);assert.equal(postEmails,0);
 console.log("QA246 WORKER PASS | tenant/role, one Resend GET, traceability, no resend or repeat");
}finally{globalThis.fetch=original}
