// LIREP ADMIN A9.2 - isolated Cloudflare Worker. No public data endpoint.
// Deployment alone does not send email. Requires cron trigger and A9_SEND_ENABLED=true.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function rpc(env,name,body){
 const response=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/rest/v1/rpc/"+name,{
  method:"POST",headers:{"apikey":env.SUPABASE_SERVICE_ROLE_KEY,"Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},
  body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
 });
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new Error("A9_RPC_"+response.status+"_"+name);
 return data;
}
async function processOne(env){
 const item=await rpc(env,"lirep_admin_a9_claim",{});
 if(!item)return false;
 const from=String(item.from_email||"").trim().toLowerCase();
 const allowed=String(env.A9_APPROVED_FROM_EMAIL||"").trim().toLowerCase();
 if(!allowed||from!==allowed){
  await rpc(env,"lirep_admin_a9_complete",{p_queue_id:item.queue_id,p_outcome:"held",p_error:"SENDER_NOT_APPROVED"});
  return true;
 }
 const title="Nueva reclamación registrada - "+item.public_code;
 const html="<main style='font:16px system-ui;color:#17243b'><h2>Nueva reclamación registrada</h2><p>Empresa: <b>"+esc(item.public_prefix)+"</b></p><p>Código: <b>"+esc(item.public_code)+"</b></p><p>Establecimiento: "+esc(item.establishment)+"</p><p>Fecha límite: "+esc(item.response_due_at)+"</p><p><a href='https://lirep-admin-360.pages.dev/'>Acceder a LIREP ADMIN</a></p><p>El detalle confidencial se consulta únicamente después de iniciar sesión.</p></main>";
 let response;
 try {
  response=await fetch("https://api.resend.com/emails",{
   method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":"lirep-a9-"+item.queue_id},
   body:JSON.stringify({from:"LIREP <"+from+">",to:[item.recipient],subject:title,html}),
   signal:AbortSignal.timeout(15000)
  });
 }catch(_){
  await rpc(env,"lirep_admin_a9_complete",{p_queue_id:item.queue_id,p_outcome:"held",p_error:"PROVIDER_OUTCOME_UNCERTAIN"});
  return true;
 }
 const data=await response.json().catch(()=>null);
 if(response.ok&&data?.id){
  try{await rpc(env,"lirep_admin_a9_complete",{p_queue_id:item.queue_id,p_outcome:"sent",p_provider_message_id:data.id});}
  catch(_){console.error("A9_ACCEPTED_BUT_COMPLETION_FAILED",item.queue_id);}
 }else{
  await rpc(env,"lirep_admin_a9_complete",{p_queue_id:item.queue_id,p_outcome:response.status===429||response.status>=500?"held":"rejected",p_error:"RESEND_HTTP_"+response.status});
 }
 return true;
}
export default {
 async fetch(){return new Response("Not found",{status:404});},
 async scheduled(_event,env,ctx){
  if(env.A9_SEND_ENABLED!=="true")return;
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.RESEND_API_KEY||!env.A9_APPROVED_FROM_EMAIL){
   console.error("A9_MISSING_CONFIGURATION");return;
  }
  ctx.waitUntil((async()=>{for(let i=0;i<5;i++){if(!(await processOne(env)))break;}})());
 }
};