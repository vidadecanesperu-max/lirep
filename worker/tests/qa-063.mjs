import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import worker from "../src/index.js";
const source=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
const origin="https://lirep-public-api.vidadecanes-peru.workers.dev";
const env={SUPABASE_URL:"https://supabase.invalid",SUPABASE_SERVICE_ROLE_KEY:"offline",TURNSTILE_SECRET:"offline",ALLOWED_ORIGINS:origin,SUBMIT_RATE_LIMITER:{async limit(){return {success:true};}}};
let calls=[];
const originalFetch=globalThis.fetch;
globalThis.fetch=async input=>{const url=String(input);calls.push(url);if(url.includes("lirep_public_origin_allowed"))return Response.json(false);throw Error("Unexpected network call: "+url);};
try{
 assert.match(source,/if \(prefix !== "LIREPQA1"\) return;/,"Email production gate must remain active");
 assert.match(source,/async scheduled\(event, env, ctx\) \{[\s\S]*?return;\s*\},/,"Cron must remain disabled");
 const response=await worker.fetch(new Request(origin+"/api/v1/complaints?public_prefix=LIREPQA1",{method:"POST",headers:{Origin:"https://untrusted.invalid","content-type":"application/json","X-LIREP-Prefix":"LIREPQA1"},body:JSON.stringify({})}),env,{waitUntil(){}});
 assert.equal(response.status,403);
 assert.equal((await response.json()).error,"ORIGIN_NOT_ALLOWED");
 assert.deepEqual(calls.map(x=>new URL(x).pathname),["/rest/v1/rpc/lirep_public_origin_allowed"]);
 console.log("PASS - Origen no autorizado sin Turnstile ni escritura");
 console.log("PASS - Correos productivos y cron permanecen deshabilitados");
 console.log("QA-063 PASS - Controles mínimos previos a staging (simulación local)");
}finally{globalThis.fetch=originalFetch;}
