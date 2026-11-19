// QA233: correo oficial obligatorio en el canal digital, WhatsApp solo complementario.
// Todas las llamadas están simuladas. Nunca se crea un reclamo real ni se envía correo.
import assert from "node:assert/strict";
import worker from "../src/index.js";

const BASE="https://lirep-public-api.vidadecanes-peru.workers.dev";
const env={
  SUBMIT_RATE_LIMITER:{async limit(){return {success:true}}},
  SUPABASE_URL:"https://fake.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY:"fake-role-only-for-test",
  TURNSTILE_SECRET:"fake-turnstile"
};
const ctx={waitUntil(){}};
const htmlResponse=await worker.fetch(new Request(BASE+"/libro-de-reclamaciones?public_prefix=LIREPQA1"),env,ctx);
assert.equal(htmlResponse.status,200);
const html=await htmlResponse.text();
assert.match(html, /name="email"[^>]*required/);
assert.match(html, /name="preferred_response_channel"[^>]*>[^<]*<option value="whatsapp">/);
assert.match(html, /La respuesta escrita oficial se envía al correo indicado/);
assert.match(html, /acepto recibir la respuesta formal en el correo indicado/);
assert.match(html, /"representative_email"\].includes\(el.name\)/);

const valid={
 idempotency_key:"55d1b5ec-108b-4b33-8329-ec7a1597b912",
 public_prefix:"LIREPQA1",establishment_code:"QA",book_code:"01",
 document_type:"dni",document_number:"12345678",
 first_names:"Cliente",last_names:"Prueba",phone:"999999999",
 address:"Calle ficticia 100",email:"consumer@example.com",
 is_minor:false,complaint_type:"reclamo",product_service_type:"servicio",
 product_service_description:"Servicio QA",amount:null,
 detail:"Una queja de prueba sin envío real",
 consumer_request:"Solicitud de prueba",consumer_conformity:true,
 preferred_response_channel:"whatsapp",turnstile_token:"mock-turnstile"
};
const originalFetch=globalThis.fetch;
const submissions=[];
globalThis.fetch=async(url,options={})=>{
 const u=new URL(url);
 if(u.hostname==="challenges.cloudflare.com"){
   return Response.json({success:true,hostname:"vidadecanes.pe"});
 }
 if(u.hostname==="fake.supabase.co" && u.pathname==="/rest/v1/rpc/lirep_submit_public_complaint_gateway"){
   submissions.push(JSON.parse(options.body));
   return Response.json([{public_code:"LIREPQA1-LR001",sequence_number:1,
     submitted_at:"2026-11-19T00:00:00Z",response_due_at:"2026-12-10T00:00:00Z",duplicate:false}]);
 }
 if(u.hostname==="fake.supabase.co" && u.pathname==="/rest/v1/rpc/lirep_issue_receipt_token"){
   return Response.json(null);
 }
 throw Error("Unexpected outgoing URL "+url);
};
const submit=async body=>{
 const request=new Request(BASE+"/api/v1/complaints?public_prefix=LIREPQA1",{
   method:"POST",headers:{
     "Origin":BASE,"Content-Type":"application/json","X-LIREP-Prefix":"LIREPQA1"
   },body:JSON.stringify(body)
 });
 const res=await worker.fetch(request,env,ctx);
 return {status:res.status,data:await res.json()};
};
try{
 const missing=await submit({...valid,email:""});
 assert.equal(missing.status,400);
 assert.equal(missing.data.error,"VALIDATION_ERROR");
 assert.equal(submissions.length,0,"no submission without official email");
 const minor=await submit({...valid,is_minor:true,representative_first_names:"Tutor",
   representative_last_names:"QA",representative_document_type:"dni",
   representative_document_number:"12345678",representative_email:""});
 assert.equal(minor.status,400);
 assert.equal(submissions.length,0,"minor requires representative official email");
 const accepted=await submit(valid);
 assert.equal(accepted.status,201);
 assert.equal(accepted.data.ok,true);
 assert.equal(submissions.length,1);
 assert.equal(submissions[0].p_email,"consumer@example.com");
 assert.equal(submissions[0].p_preferred_response_channel,"whatsapp");
}finally{globalThis.fetch=originalFetch}
console.log("QA233 PASS | official email required / WhatsApp contact preference / minor representative email / no real requests");
