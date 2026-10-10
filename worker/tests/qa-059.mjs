import assert from "node:assert/strict";
import worker from "../src/index.js";

const origin = "https://lirep-public-api.vidadecanes-peru.workers.dev";
const env = {SUPABASE_URL:"https://supabase.invalid",SUPABASE_SERVICE_ROLE_KEY:"offline",TURNSTILE_SECRET:"offline",ALLOWED_ORIGINS:origin,SUBMIT_RATE_LIMITER:{async limit(){return {success:true};}}};
const base={idempotency_key:"afdaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",public_prefix:"LIREPQA1",establishment_code:"QA001",book_code:"QA001",document_type:"dni",document_number:"12345678",first_names:"Prueba",last_names:"Local",email:"prueba@example.invalid",phone:"999999999",address:"Dirección de prueba",is_minor:false,complaint_type:"reclamo",product_service_type:"servicio",product_service_description:"Servicio",amount:"1",detail:"Prueba local",consumer_request:"Validar",consumer_conformity:true,preferred_response_channel:"email",turnstile_token:"offline"};
let duplicate=false, failToken=false;
const calls=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async input=>{
 const url=String(input);calls.push(url);
 if(url.includes("siteverify"))return Response.json({success:true,hostname:"lirep-public-api.vidadecanes-peru.workers.dev"});
 if(url.includes("lirep_submit_public_complaint_gateway"))return Response.json([{public_code:"LIREPQA1-QA001-2026-00000099",duplicate}]);
 if(url.includes("lirep_issue_receipt_token"))return failToken?Response.json({message:"SIMULATED_TOKEN_FAILURE"},{status:500}):Response.json("12345678-1234-4234-8234-123456789abc");
 throw Error("Unexpected external call: "+url);
};
const ctx={waitUntil(p){return p;}};
const request=()=>new Request(origin+"/api/v1/complaints?public_prefix=LIREPQA1",{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,"X-LIREP-Prefix":"LIREPQA1"},body:JSON.stringify(base)});
try{
 let response=await worker.fetch(request(),env,ctx);
 let data=await response.json();
 assert.equal(response.status,201,JSON.stringify(data));
 assert.equal(data.complaint.duplicate,false);
 assert.ok(data.complaint.receipt_token);
 console.log("PASS - Primera solicitud confirmada (respuesta simulada como perdida)");

 duplicate=true;calls.length=0;
 response=await worker.fetch(request(),env,ctx);data=await response.json();
 assert.equal(response.status,201,JSON.stringify(data));
 assert.equal(data.complaint.duplicate,true);
 assert.equal(data.complaint.receipt_token,null);
 assert.equal(calls.filter(x=>x.includes("lirep_issue_receipt_token")).length,0);
 console.log("PASS - Reintento devuelve código sin reemitir token");
 console.log("OBSERVACION - Si se pierde la primera respuesta, no existe enlace inmediato a la constancia en el reintento");

 duplicate=false;failToken=true;calls.length=0;
 response=await worker.fetch(request(),env,ctx);data=await response.json();
 assert.equal(response.status,201,JSON.stringify(data));
 assert.equal(data.complaint.duplicate,false);
 assert.equal(data.complaint.receipt_token,null);
 console.log("PASS - Fallo de emisión de token no revierte registro");

 assert.equal(calls.some(x=>x.includes("api.resend.com")),false);
 assert.equal(calls.some(x=>x.includes("lirep_queue_receipt_email")),false);
 console.log("PASS - Sin envíos ni colas de correo durante pruebas");

 console.log("QA-059 PASS - Recuperación parcial ante respuesta perdida; riesgo UX documentado");
}finally{globalThis.fetch=originalFetch;}
