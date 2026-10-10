import assert from "node:assert/strict";
import worker from "../src/index.js";

const origin = "https://lirep-public-api.vidadecanes-peru.workers.dev";
const env = { SUPABASE_URL:"https://supabase.invalid", SUPABASE_SERVICE_ROLE_KEY:"offline", TURNSTILE_SECRET:"offline", ALLOWED_ORIGINS:origin, SUBMIT_RATE_LIMITER:{ async limit(){return {success:true};} } };
const base = {idempotency_key:"afdaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",public_prefix:"LIREPQA1",establishment_code:"QA001",book_code:"QA001",document_type:"dni",document_number:"12345678",first_names:"Prueba",last_names:"Local",email:"prueba@example.invalid",phone:"999999999",address:"Dirección de prueba",is_minor:false,complaint_type:"reclamo",product_service_type:"servicio",product_service_description:"Servicio",amount:"1",detail:"Prueba local",consumer_request:"Validar",consumer_conformity:true,preferred_response_channel:"email",turnstile_token:"offline"};
let turnstileOK=true, conflict=false, rpcCount=0;
const calls=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async input=>{
 const url=String(input); calls.push(url);
 if(url.includes("lirep_public_origin_allowed"))return Response.json(false);
 if(url.includes("siteverify"))return Response.json({success:turnstileOK,hostname:"lirep-public-api.vidadecanes-peru.workers.dev"});
 if(url.includes("lirep_submit_public_complaint_gateway"))return conflict?Response.json({message:"LIREP_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"},{status:400}):Response.json([{public_code:"LIREPQA1-QA001-2026-00000099",duplicate:false}]);
 if(url.includes("lirep_issue_receipt_token")){rpcCount++;return Response.json("12345678-1234-4234-8234-123456789abc");}
 throw Error("Unexpected external call "+url);
};
const ctx={waitUntil(p){return p;}};
const req=(body=base,headers={Origin:origin})=>new Request(origin+"/api/v1/complaints?public_prefix=LIREPQA1",{method:"POST",headers:{"Content-Type":"application/json","X-LIREP-Prefix":"LIREPQA1",...headers},body:JSON.stringify(body)});
try{
 let r=await worker.fetch(req(base,{Origin:"https://unauthorized.example"}),env,ctx);
 assert.equal(r.status,403);assert.equal((await r.json()).error,"ORIGIN_NOT_ALLOWED");
 assert.equal(calls.length,1);
 assert.ok(calls[0].includes("lirep_public_origin_allowed"));
 console.log("PASS - Origen no autorizado (consulta de autorización sin registrar reclamación)");

 turnstileOK=false;calls.length=0;r=await worker.fetch(req(),env,ctx);
 assert.equal(r.status,403);assert.equal((await r.json()).error,"TURNSTILE_FAILED");
 assert.equal(rpcCount,0);console.log("PASS - Turnstile inválido");
 turnstileOK=true;

 conflict=true;calls.length=0;r=await worker.fetch(req(),env,ctx);
 assert.equal(r.status,409);assert.equal((await r.json()).error,"IDEMPOTENCY_CONFLICT");
 assert.equal(rpcCount,0);console.log("PASS - Conflicto de idempotencia");
 conflict=false;

 calls.length=0;r=await worker.fetch(new Request(origin+"/constancia?public_prefix=LIREPQA1&code=LIREPQA1-QA001-2026-00000099&token=invalid"),env,ctx);
 assert.equal(r.status,400);assert.equal((await r.json()).error,"INVALID_RECEIPT_REFERENCE");
 assert.equal(calls.length,0);console.log("PASS - Token inválido rechazado");

 console.log("QA-057 PASS - Errores controlados sin escrituras ni envíos");
}finally{globalThis.fetch=originalFetch;}
