import assert from "node:assert/strict";
import worker from "../src/index.js";

const env={SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test-only",RESEND_API_KEY:"test-only",LIREP_ONBOARDING_ENABLED:"true"};
const ctx={waitUntil(){}};
const call=async(path,method="GET",body,vars=env)=>{
  const r=await worker.fetch(new Request("https://lirep.example.workers.dev"+path,{
    method,headers:{"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})
  }),vars,ctx);
  return {status:r.status,data:await r.json()};
};
const disabled=await call("/api/v1/onboarding/capabilities","GET",null,{...env,LIREP_ONBOARDING_ENABLED:"false"});
assert.equal(disabled.data.enabled,false);
const enabled=await call("/api/v1/onboarding/capabilities");
assert.equal(enabled.data.enabled,true);
const bad=await call("/api/v1/onboarding/start","POST",{domain:"localhost",challenge_url:"https://localhost/wp-json/lirep/v1/challenge"});
assert.equal(bad.status,400);
assert.equal(bad.data.error,"invalid_input");
const missing=await call("/api/v1/onboarding/start","POST",{}, {...env,LIREP_ONBOARDING_ENABLED:"false"});
assert.equal(missing.status,503);
assert.equal(missing.data.error,"onboarding_not_enabled");

const savedFetch=globalThis.fetch;
const calls=[];
const mailBodies=[];
let row=null;
let issuedToken='Ab9_z-'.repeat(7),issuedType='signup';
let failUserIdOnce=true;
let authResponseMode='no_hash';
globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url);
  calls.push({url:u.href,method:opts.method||"GET"});
  if(u.hostname==="example.supabase.co"&&u.pathname==="/rest/v1/organizations")
    return Response.json([]);
  if(u.hostname==="example.supabase.co"&&u.pathname==="/rest/v1/organization_domains")
    return Response.json([]);
  if(u.hostname==="example.supabase.co"&&u.pathname==="/rest/v1/lirep_onboarding_requests"){
    if(opts.method==="POST"){
      row={...JSON.parse(opts.body),id:"123e4567-e89b-42d3-a456-426614174000",expires_at:new Date(Date.now()+86400000).toISOString(),
        email_verified_at:null,domain_verified_at:null,invitation_sent_at:null,public_prefix:null};
      return Response.json([row]);
    }
    if(opts.method==="PATCH"){Object.assign(row,JSON.parse(opts.body));return Response.json([row]);}
    return Response.json(row?[row]:[]);
  }
  if(u.hostname==="cliente.com"&&u.pathname==="/wp-json/lirep/v1/challenge")
    return Response.json({challenge:globalThis.challengeForTest});
  if(u.hostname==="api.resend.com"){
    mailBodies.push(JSON.parse(opts.body));
    return Response.json({id:"mock-resend-id"});
  }
  if(u.hostname==="example.supabase.co"&&u.pathname==="/auth/v1/admin/generate_link")
    return Response.json({user:{id:failUserIdOnce?(failUserIdOnce=false,"INVALID_USER"):"123e4567-e89b-42d3-a456-426614174001"},properties:authResponseMode==="no_hash"?{}:{action_link:"https://example.supabase.co/auth/v1/verify?token="+issuedToken,hashed_token:"x",verification_type:issuedType}});
  if(u.hostname==="example.supabase.co"&&u.pathname==="/rest/v1/rpc/lirep_onboarding_activate"){
    row.state="active";row.public_prefix="TEST1234";row.invitation_sent_at=new Date().toISOString();
    return Response.json({public_prefix:"TEST1234"});
  }
  throw Error("Unexpected mocked URL: "+u.href);
};
try{
  const input={domain:"cliente.com",challenge_url:"https://cliente.com/wp-json/lirep/v1/challenge",
    ruc:"20601234567",legal_name:"Empresa QA",trade_name:"QA",contact_email:"admin@cliente.com",
    address:"Calle de prueba",district:"Lima",province:"Lima",department:"Lima",
    privacy_policy_url:"https://cliente.com/privacidad"};
  const start=await call("/api/v1/onboarding/start","POST",input);
  assert.equal(start.status,200,JSON.stringify(start));
  assert.match(start.data.challenge,/^[a-f0-9]{64}$/);
  globalThis.challengeForTest=start.data.challenge;
  const credentials={id:start.data.id,status_token:start.data.status_token,challenge_url:input.challenge_url};
  const verify=await call("/api/v1/onboarding/verify-domain","POST",credentials);
  assert.equal(verify.status,200,JSON.stringify(verify));
  assert.equal(verify.data.state.domain_verified,true);
  assert(calls.some(c=>c.url.startsWith("https://api.resend.com/emails")));
  const status=await call("/api/v1/onboarding/status","POST",credentials);
  assert.equal(status.data.state.domain_verified,true);
  assert.equal(status.data.state.email_verified,false);
  const wrong=await call("/api/v1/onboarding/status","POST",{...credentials,status_token:"0".repeat(64)});
  assert.equal(wrong.status,403);
  const mail=mailBodies[0];
  assert(mail?.html?.includes("/api/v1/onboarding/confirm"));
  const link=mail.html.match(/href="([^"]+)"/)[1].replaceAll("&amp;","&");
  const linkUrl=new URL(link);
  const landing=await worker.fetch(new Request(link),env,ctx);
  assert.equal(landing.status,200);
  const firstConfirmation=await worker.fetch(new Request(link,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({id:linkUrl.searchParams.get("id"),token:linkUrl.searchParams.get("token")}).toString()}),env,ctx);
  assert.equal(firstConfirmation.status,503,"Invalid user ID gets a safe retry page");
  const retryHtml=await firstConfirmation.text();
  assert.match(retryHtml,/Reintentar activación/);
  assert.doesNotMatch(retryHtml,/ONBOARDING_AUTH_|HASH_UNKNOWN|activation_auth_unavailable/);
  assert.equal(row.state,"pending","No partial company activation on auth error");
  assert.equal(mailBodies.length,1,"No duplicate notification on failed auth");
  const confirmation=await worker.fetch(new Request(link,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({id:linkUrl.searchParams.get("id"),token:linkUrl.searchParams.get("token")}).toString()}),env,ctx);
  assert.equal(confirmation.status,200);
  const active=await call("/api/v1/onboarding/status","POST",credentials);
  assert.equal(active.data.state.state,"active");
  assert.equal(active.data.state.public_prefix,"TEST1234");
  assert.equal(mailBodies.length,2);
  const adminMail=mailBodies[1].html;
  assert.match(adminMail,/https:\/\/lirep\.360insol\.com\/\?public_prefix=TEST1234/);
  assert.ok(!adminMail.includes("/auth/v1/verify"),"No direct verify GET link in access email");
  assert.ok(!adminMail.includes("lirep_login_token"),"Activation email never embeds OTP");
  assert.ok(!adminMail.includes("lirep_login_type"),"Activation ignores GoTrue token type");
  assert.ok(adminMail.includes("Enviar enlace de acceso"),"User requests own OTP on login");
  assert.ok(!adminMail.includes(issuedToken),"Even opaque provider token is not used");

  const cancelled=await call("/api/v1/onboarding/cancel","POST",credentials);
  assert.equal(cancelled.status,409);
  // Regression: existing users get an ordinary 64-character magiclink.
  // No second email is sent to any real address; this is a mocked cycle.
  row=null;issuedToken="a".repeat(64);issuedType="magiclink";authResponseMode="with_malformed_hash";
  const secondStart=await call("/api/v1/onboarding/start","POST",input);
  assert.equal(secondStart.status,200);
  globalThis.challengeForTest=secondStart.data.challenge;
  const secondCredentials={id:secondStart.data.id,status_token:secondStart.data.status_token,challenge_url:input.challenge_url};
  assert.equal((await call("/api/v1/onboarding/verify-domain","POST",secondCredentials)).status,200);
  const secondMail=mailBodies[2].html;
  const secondLink=secondMail.match(/href="([^"]+)"/)[1].replaceAll("&amp;","&");
  const secondUrl=new URL(secondLink);
  const secondResponse=await worker.fetch(new Request(secondLink,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({id:secondUrl.searchParams.get("id"),token:secondUrl.searchParams.get("token")}).toString()}),env,ctx);
  assert.equal(secondResponse.status,200);
  assert.ok(mailBodies[3].html.includes("Enviar enlace de acceso"));
  assert.ok(!mailBodies[3].html.includes("lirep_login_token"));
  assert.ok(!mailBodies[3].html.includes("lirep_login_type"));
  assert.ok(!mailBodies[3].html.includes(issuedToken));
  assert.equal((await call("/api/v1/onboarding/status","POST",secondCredentials)).data.state.state,"active");
}finally{globalThis.fetch=savedFetch;}
console.log("PASS QA260: activation independent of OTP hash, secure user ID, single tenant, retry, login link only");
