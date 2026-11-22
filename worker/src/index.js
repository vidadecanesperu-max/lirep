// Only presentation changes: the full code remains the immutable database lookup key.
function displayComplaintCode(code) {
  return String(code || "").replace(/^[A-Z0-9]{8}-(?=LR[0-9]+-)/, "");
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const selfOrigin = new URL(request.url).origin;
  if (!origin || (origin !== selfOrigin && !allowed.includes(origin))) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-LIREP-Prefix",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function requiredString(value, max) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > max) return null;
  return v;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function verifyTurnstile(token, request, env) {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    console.warn("LIREP_TURNSTILE", "TOKEN_MISSING_OR_INVALID");
    return false;
  }
  if (!env.TURNSTILE_SECRET) {
    console.error("LIREP_TURNSTILE", "SECRET_NOT_CONFIGURED");
    return false;
  }
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.warn("LIREP_TURNSTILE", "SITEVERIFY_HTTP_ERROR", response.status);
      return false;
    }
    const result = await response.json();
    if (result.success !== true) {
      // Cloudflare error codes are safe to log; never log the response token, secret or IP.
      console.warn("LIREP_TURNSTILE", "SITEVERIFY_REJECTED",
        Array.isArray(result["error-codes"]) ? result["error-codes"].join(",") : "UNKNOWN");
      return false;
    }
    const hostname = String(result.hostname || "").toLowerCase().replace(/\\.$/, "");
    const allowed = ["vidadecanes.pe", "energesmoto.com", "www.energesmoto.com",
      "lirep-public-api.vidadecanes-peru.workers.dev"];
    if (!allowed.includes(hostname)) {
      console.warn("LIREP_TURNSTILE", "HOSTNAME_MISMATCH", hostname);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("LIREP_TURNSTILE", "SITEVERIFY_UNAVAILABLE",
      error?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR");
    return false;
  }
}

async function supabaseConnectivity(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "BACKEND_CONFIGURATION_MISSING" };
  }

  try {
    const response = await fetch(
      env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/lirep_public_form_config",
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "content-type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ p_public_prefix: "00000000" }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (response.ok) return { ok: true };

    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "BACKEND_AUTH_FAILED" };
    }

    if (response.status >= 500) {
      return { ok: false, error: "BACKEND_UPSTREAM_FAILED" };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "BACKEND_UNREACHABLE" };
  }
}

async function originAllowedForPrefix(origin, publicPrefix, env) {
  if (!origin || !publicPrefix || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const response = await fetch(
      env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/lirep_public_origin_allowed",
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "content-type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ p_public_prefix: publicPrefix, p_origin: origin }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch {
    return false;
  }
}

function corsForOrigin(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-LIREP-Prefix",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}


function escHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
}

async function receiptData(publicPrefix, publicCode, accessToken, env) {
  const response = await fetch(
    env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/lirep_secure_receipt_data",
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ p_public_prefix: publicPrefix, p_public_code: publicCode, p_access_token: accessToken }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) return null;
  return await response.json();
}

function receiptHtml(d) {
  const o=d.organization||{}, e=d.establishment||{}, co=d.consumer||{};
  const submitted=d.submitted_at?new Date(d.submitted_at).toLocaleString("es-PE",{timeZone:"America/Lima"}):"";
  const due=d.response_due_at?new Date(d.response_due_at).toLocaleDateString("es-PE",{timeZone:"America/Lima"}):"";
  const amount=d.amount===null||d.amount===undefined||d.amount===""?"No consignado":"S/ "+Number(d.amount).toFixed(2);
  const representative=co.is_minor?`<section><h2>Representante del menor</h2><p><b>Nombre:</b> ${escHtml([co.representative_first_names,co.representative_last_names].filter(Boolean).join(" "))}</p><p><b>Documento:</b> ${escHtml(co.representative_document_type)} ${escHtml(co.representative_document_number)}</p></section>`:"";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Constancia ${escHtml(displayComplaintCode(d.public_code))}</title><style>body{font-family:Arial,sans-serif;color:#111827;margin:0;background:#f3f4f6}.page{max-width:820px;margin:24px auto;background:#fff;padding:34px;border:1px solid #d1d5db}.top{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111827;padding-bottom:18px}h1{font-size:24px;margin:0}h2{font-size:16px;margin:22px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:6px}p{margin:6px 0;line-height:1.45}.code{font-weight:800;font-size:18px;word-break:break-word}.muted{color:#6b7280}.actions{margin:18px 0}.actions button{padding:11px 16px;border:0;border-radius:8px;background:#111827;color:#fff;font-weight:700;cursor:pointer}.foot{margin-top:28px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:14px}@page{size:A4;margin:10mm}@media print{html,body{background:#fff;margin:0;padding:0} @page{margin:8mm} .page{border:0;margin:0;max-width:none;padding:0;font-size:11px}.top{padding-bottom:10px}.top h1{font-size:20px}h2{margin:12px 0 5px;font-size:14px}p{margin:3px 0;line-height:1.3}.actions{display:none}.foot{margin-top:14px;padding-top:8px;font-size:9px}section{break-inside:avoid;page-break-inside:avoid}}@media(max-width:650px){.page{margin:0;padding:20px;border:0}.top{display:block}}</style></head><body><main class="page"><div class="top"><div><h1>Constancia del Libro de Reclamaciones</h1><p class="muted">${escHtml(o.trade_name||o.legal_name)}</p></div><div><div class="code">${escHtml(displayComplaintCode(d.public_code))}</div><p>${escHtml(submitted)}</p></div></div><div class="actions"><button onclick="window.print()">Imprimir / Guardar como PDF</button></div><section><h2>Proveedor</h2><p><b>Razón social:</b> ${escHtml(o.legal_name)}</p><p><b>RUC:</b> ${escHtml(o.ruc)}</p><p><b>Establecimiento:</b> ${escHtml(e.name)} (${escHtml(e.code)})</p><p><b>Dirección:</b> ${escHtml([e.address,e.district,e.province,e.department].filter(Boolean).join(", "))}</p></section><section><h2>Consumidor</h2><p><b>Nombre:</b> ${escHtml([co.first_names,co.last_names].filter(Boolean).join(" "))}</p><p><b>Documento:</b> ${escHtml(co.document_type)} ${escHtml(co.document_number)}</p><p><b>Teléfono:</b> ${escHtml(co.phone)}</p><p><b>Correo:</b> ${escHtml(co.email||"No consignado")}</p><p><b>Domicilio:</b> ${escHtml(co.address)}</p></section>${representative}<section><h2>Bien o servicio</h2><p><b>Tipo:</b> ${escHtml(d.product_service_type)}</p><p><b>Descripción:</b> ${escHtml(d.product_service_description)}</p><p><b>Monto:</b> ${escHtml(amount)}</p></section><section><h2>${escHtml(String(d.complaint_type||"").toUpperCase())}</h2><p><b>Detalle:</b> ${escHtml(d.detail)}</p><p><b>Pedido:</b> ${escHtml(d.consumer_request)}</p></section><section><h2>Registro electrónico</h2><p><b>Conformidad:</b> ${d.consumer_conformity?"Sí":"No"}</p><p><b>Canal indicado para contacto:</b> ${escHtml(d.preferred_response_channel)}</p><p><b>Fecha límite registrada para respuesta:</b> ${escHtml(due)}</p></section><div class="foot">Esta constancia corresponde al registro electrónico identificado por el código indicado. © ${new Date().getFullYear()} · Powered by 360 Integral Solutions</div></main></body></html>`;
}


async function lirepRpc(name, payload, env) {
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "RPC_FAILED");
  return data;
}
const LIREP_NOTIFICATION_SENDER = "notificaciones@360insol.com";
function approvedReceiptSender(email) {
  return String(email || "").trim().toLowerCase() === LIREP_NOTIFICATION_SENDER;
}

async function sendSecureReceipt(prefix, code, env) {
  // QA permitido por defecto; multiempresa solo con activación explícita.
  if (prefix !== "LIREPQA1" && env.LIREP_ENABLE_MULTIEMPRESA_EMAIL !== "true") return;
  if (!env.RESEND_API_KEY) return;
  const queued = await lirepRpc("lirep_queue_receipt_email", {p_public_prefix:prefix,p_public_code:code}, env);
  if (!queued?.queued) return;
  const job = await lirepRpc("lirep_claim_receipt_email_by_id", {p_queue_id:queued.queue_id}, env);
  if (!job) return;
  const link = "https://lirep-public-api.vidadecanes-peru.workers.dev/constancia?public_prefix=" + encodeURIComponent(job.public_prefix) + "&code=" + encodeURIComponent(job.public_code) + "&token=" + encodeURIComponent(job.receipt_token);
  const html = "<h2>Constancia del Libro de Reclamaciones</h2><p>Tu registro fue recibido.</p><p><b>Codigo:</b> " + escHtml(displayComplaintCode(job.public_code)) + "</p><p><a href=\"" + escHtml(link) + "\">Ver y guardar constancia</a></p><p>Este correo es automatico y no esta supervisado. No responda a este mensaje.</p>";
  let accepted = false;
  try {
    if (!approvedReceiptSender(job.from_email)) throw new Error("EMAIL_SENDER_NOT_APPROVED");
    const response = await fetch("https://api.resend.com/emails", {
      method:"POST",
      headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"content-type":"application/json"},
      body:JSON.stringify({from:job.from_name+" <"+job.from_email+">",to:[job.recipient],subject:"Constancia del Libro de Reclamaciones - "+displayComplaintCode(job.public_code),html}),
      signal:AbortSignal.timeout(15000)
    });
    const result=await response.json().catch(()=>null);
    if (!response.ok || !result?.id) throw new Error(result?.message || "EMAIL_PROVIDER_FAILED");
    accepted = true;
    await lirepRpc("lirep_complete_receipt_email",{p_queue_id:job.queue_id,p_success:true,p_provider:"resend",p_provider_message_id:result.id,p_error:null},env);
  } catch(error) {
    if (accepted) { console.error("EMAIL_ACCEPTED_COMPLETION_FAILED", job.queue_id); return; }
    await lirepRpc("lirep_complete_receipt_email",{p_queue_id:job.queue_id,p_success:false,p_provider:"resend",p_provider_message_id:null,p_error:String(error?.message||error)},env).catch(()=>{});
  }
}


/* Universal WordPress onboarding. All credentials remain server-side. */
const onboardingBase = "/api/v1/onboarding/";
const onboardingJsonHeaders = {"content-type":"application/json","accept":"application/json"};
const onboardingRandom = (bytes=32) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)),v=>v.toString(16).padStart(2,"0")).join("");
async function onboardingHash(value) {
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,"0")).join("");
}
function onboardingHost(input) {
  if(typeof input!=="string" || input.length>253) return null;
  const host=input.toLowerCase().replace(/\.$/,"");
  if(!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  if(host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host.endsWith(".test")||host.endsWith(".example")||host.endsWith(".invalid"))return null;
  return host;
}
function onboardingUrl(host, raw) {
  try {
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.hostname.toLowerCase()!==host||u.port||u.username||u.password||u.hash)return null;
    const pretty=!u.search&&(u.pathname.endsWith("/wp-json/lirep/v1/challenge")||u.pathname.endsWith("/index.php/wp-json/lirep/v1/challenge"));
    const plain=u.searchParams.size===1&&u.searchParams.get("rest_route")==="/lirep/v1/challenge"&&u.pathname.endsWith("/");
    if(!pretty&&!plain)return null;
    return u.href;
  }catch{return null;}
}
async function onboardingDb(env,path,method="GET",payload) {
  const res=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/rest/v1/"+path,{
    method,headers:{...onboardingJsonHeaders,apikey:env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,Prefer:"return=representation"},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(12000)
  });
  const body=await res.json().catch(()=>null);
  if(!res.ok)throw new Error("ONBOARDING_DATABASE_ERROR_"+res.status);
  return body;
}
async function onboardingRow(env,id) {
  const rows=await onboardingDb(env,"lirep_onboarding_requests?id=eq."+encodeURIComponent(id)+"&select=*");
  return Array.isArray(rows)?rows[0]:null;
}
async function onboardingMail(env,to,subject,html) {
  const res=await fetch("https://api.resend.com/emails",{method:"POST",
    headers:{"content-type":"application/json",Authorization:"Bearer "+env.RESEND_API_KEY},
    body:JSON.stringify({from:"LIREP <notificaciones@360insol.com>",to:[to],subject,html}),
    signal:AbortSignal.timeout(15000)});
  const data=await res.json().catch(()=>null);
  if(!res.ok||!data?.id)throw new Error("ONBOARDING_EMAIL_UNAVAILABLE");
}
function onboardingSafeText(value,max) {
  return typeof value==="string"&&value.trim()&&value.trim().length<=max?value.trim():null;
}
function onboardingState(row) {
  return {state:row.state,email_verified:!!row.email_verified_at,
    domain_verified:!!row.domain_verified_at,invitation_sent:!!row.invitation_sent_at,
    public_prefix:row.state==="active"?row.public_prefix:null};
}
// QA259: human-readable retry after a transient backend failure.
// Only works with the original verified one-time confirmation credentials.
// No automatic retries, tenant reset, or exposure of internal diagnostics.
function onboardingConfirmRetry(id,token) {
  const page='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LIREP · Activación pendiente</title><main style="font:16px system-ui;max-width:560px;margin:10vh auto;padding:24px;color:#172842"><h1>Activación pendiente de completar</h1><p>Ya verificamos el dominio y el correo, pero el acceso administrativo no pudo prepararse. No reinstales el plugin ni reinicies el registro.</p><p>Vuelve a intentar con el mismo enlace de confirmación.</p><form method="post"><input type="hidden" name="id" value="'+id+'"><input type="hidden" name="token" value="'+token+'"><button style="background:#172842;color:#fff;border:0;border-radius:6px;padding:14px 22px;cursor:pointer">Reintentar activación</button></form></main></html>';
  return new Response(page,{status:503,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'"}});
}
async function onboardingAuthLink(env,email) {
  const res=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/auth/v1/admin/generate_link",{
    method:"POST",headers:{...onboardingJsonHeaders,apikey:env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY},
    body:JSON.stringify({type:"magiclink",email,options:{redirect_to:"https://lirep.360insol.com/"}}),
    signal:AbortSignal.timeout(12000)});
  const data=await res.json().catch(()=>null);
  // Supabase GoTrue returns the generated URL inside properties.action_link.
  // Some SDK wrappers expose it at the top level; support both without logging tokens.
  const actionLink=data?.properties?.action_link||data?.action_link;
  // QA259: token_hash is opaque. GoTrue returns base64url and hex variants,
  // not a guaranteed 64-char lowercase SHA-256 string. Never normalize its case.
  // The verification type may be signup when magiclink created a new user.
  let tokenHash=data?.properties?.hashed_token||data?.hashed_token||"";
  const verificationType=data?.properties?.verification_type||data?.verification_type||"";
  if(!tokenHash&&typeof actionLink==="string"){
    try {
      const link=new URL(actionLink);
      if(link.hostname===new URL(env.SUPABASE_URL).hostname&&link.pathname==="/auth/v1/verify")
        tokenHash=link.searchParams.get("token")||"";
    }catch{}
  }
  const userId=data?.user?.id||data?.id;
  // Fail closed for malformed tokens, unexpected providers and invalid user ID.
  const validToken=typeof tokenHash==="string"&&/^[A-Za-z0-9_-]{20,256}$/.test(tokenHash);
  const validType=["magiclink","signup","invite"].includes(verificationType);
  if(!res.ok||!isUuid(userId)||!validToken||!validType){
    const code=typeof data?.code==="string"?data.code:(typeof data?.error_code==="string"?data.error_code:"unknown");
    console.error("LIREP_AUTH_GENERATE_LINK",JSON.stringify({
      status:res.status,code,has_user:isUuid(userId),has_hash:!!tokenHash,
      hash_format_ok:validToken,verification_type_valid:validType
    }));
    // No token, email, URL, or service credentials appear in diagnostics.
    throw new Error("ONBOARDING_AUTH_"+res.status+"_"+(res.ok?"SHAPE":"HTTP")+
      "_"+(isUuid(userId)?"USER":"NOUSER")+"_"+(validToken?"TOKENOK":"TOKENINVALID")+
      "_"+(validType?"TYPEOK":"TYPEINVALID")+"_"+
      (code==="unknown"?"UNKNOWN":code.replace(/[^a-zA-Z0-9_]/g,"").slice(0,40)));
  }
  return {user:{id:userId},token_hash:tokenHash,verification_type:verificationType};
}
async function onboardingRoute(request,env,url) {
  const path=url.pathname.slice(onboardingBase.length);
  if(path==="capabilities"&&request.method==="GET") {
    const enabled=env.LIREP_ONBOARDING_ENABLED==="true"&&!!env.SUPABASE_URL&&!!env.SUPABASE_SERVICE_ROLE_KEY&&!!env.RESEND_API_KEY;
    return json({ok:true,enabled,admin_url:"https://lirep.360insol.com"},200,{"cache-control":"no-store"});
  }
  if(env.LIREP_ONBOARDING_ENABLED!=="true"||!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY||!env.RESEND_API_KEY)
    return json({ok:false,error:"onboarding_not_enabled"},503);
  if(path==="confirm"&&request.method==="GET") {
    const id=url.searchParams.get("id")||"",token=url.searchParams.get("token")||"";
    if(!isUuid(id)||!/^[a-f0-9]{64}$/.test(token))return json({ok:false,error:"invalid_token"},400);
    const page='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Confirmar LIREP</title><main style="font:16px system-ui;max-width:560px;margin:10vh auto;padding:24px"><h1>Confirmación de correo LIREP</h1><p>Confirma que autorizas el registro de esta empresa y la administración de su Libro de Reclamaciones.</p><form method="post"><input type="hidden" name="id" value="'+id+'"><input type="hidden" name="token" value="'+token+'"><button style="padding:14px 22px">Confirmar y activar</button></form></main></html>';
    return new Response(page,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'"}});
  }
  if(!["start","status","verify-domain","cancel","confirm"].includes(path)||request.method!=="POST")
    return json({ok:false,error:"NOT_FOUND"},404);
  const raw=await request.text();
  if(raw.length>12000)return json({ok:false,error:"invalid_input"},400);
  let input;
  if(path==="confirm"){input=Object.fromEntries(new URLSearchParams(raw));}
  else{try{input=JSON.parse(raw);}catch{return json({ok:false,error:"invalid_input"},400);}}
  if(!input||typeof input!=="object")return json({ok:false,error:"invalid_input"},400);
  if(path==="start") {
    const ip=request.headers.get("CF-Connecting-IP")||"unknown";
    if(env.SUBMIT_RATE_LIMITER) {
      const limit=await env.SUBMIT_RATE_LIMITER.limit({key:"onboard:"+ip});
      if(!limit.success)return json({ok:false,error:"rate_limited"},429);
    }
    const host=onboardingHost(input.domain),challengeUrl=host&&onboardingUrl(host,input.challenge_url);
    const ruc=typeof input.ruc==="string"&&/^\d{11}$/.test(input.ruc)?input.ruc:null;
    const legal=onboardingSafeText(input.legal_name,200),email=onboardingSafeText(input.contact_email,254)?.toLowerCase();
    const address=onboardingSafeText(input.address,300),district=onboardingSafeText(input.district,100);
    const province=onboardingSafeText(input.province,100),department=onboardingSafeText(input.department,100);
    const privacy=onboardingSafeText(input.privacy_policy_url,1000);
    if(!host||!challengeUrl||!ruc||!legal||!email||!isEmail(email)||!address||!district||!province||!department||!privacy||!privacy.startsWith("https://"))
      return json({ok:false,error:"invalid_input"},400);
    const privacyValid=(()=>{try{const p=new URL(privacy);return p.protocol==="https:"&&!p.username&&!p.password;}catch{return false;}})();
    if(!privacyValid)return json({ok:false,error:"invalid_input"},400);
    const occupied=await onboardingDb(env,"organizations?or=(ruc.eq."+ruc+",website.eq."+encodeURIComponent("https://"+host)+")&select=id&limit=1");
    const domainTaken=await onboardingDb(env,"organization_domains?hostname=eq."+encodeURIComponent(host)+"&select=id&limit=1");
    if(occupied.length||domainTaken.length)return json({ok:false,error:"review_required"},409);
    const pending=await onboardingDb(env,"lirep_onboarding_requests?hostname=eq."+encodeURIComponent(host)+"&state=eq.pending&expires_at=gt."+encodeURIComponent(new Date().toISOString())+"&select=id&limit=1");
    if(pending.length)return json({ok:false,error:"rate_limited"},429);
    const challenge=onboardingRandom(),statusToken=onboardingRandom(),emailToken=onboardingRandom();
    const inserted=await onboardingDb(env,"lirep_onboarding_requests","POST",{
      ruc,legal_name:legal,trade_name:onboardingSafeText(input.trade_name,200),
      contact_email:email,hostname:host,challenge_url:challengeUrl,
      challenge_hash:await onboardingHash(challenge),status_token_hash:await onboardingHash(statusToken),
      email_token_hash:await onboardingHash(emailToken),address,district,province,department,
      privacy_policy_url:privacy,state:"pending"});
    const row=inserted?.[0];
    if(!row?.id)throw new Error("ONBOARDING_INSERT_FAILED");
    return json({ok:true,id:row.id,status_token:statusToken,challenge},200);
  }
  const id=typeof input.id==="string"?input.id:"";
  if(!isUuid(id))return json({ok:false,error:"invalid_token"},400);
  const row=await onboardingRow(env,id);
  if(!row)return json({ok:false,error:"invalid_token"},404);
  if(path==="confirm") {
    if(!/^[a-f0-9]{64}$/.test(input.token||"")||await onboardingHash(input.token)!==row.email_token_hash)
      return json({ok:false,error:"invalid_token"},403);
    if(row.expires_at<=new Date().toISOString()||row.state!=="pending"||!row.domain_verified_at)
      return json({ok:false,error:"expired"},409);
    // Email proof is established only by possession of the one-time confirmation link.
    await onboardingDb(env,"lirep_onboarding_requests?id=eq."+id,"PATCH",{email_verified_at:new Date().toISOString()});
    let auth;
    try { auth=await onboardingAuthLink(env,row.contact_email); }
    catch(error) { const diagnostic=String(error?.message||error); console.error("LIREP_ONBOARDING_AUTH",diagnostic); return onboardingConfirmRetry(id,input.token); }
    let activation;
    try { activation=await lirepRpc("lirep_onboarding_activate",{p_request_id:id,p_user_id:auth.user.id},env); }
    catch(error) { console.error("LIREP_ONBOARDING_TENANT",String(error?.message||error)); return onboardingConfirmRetry(id,input.token); }
    try {
      const activatedPrefix=typeof activation?.public_prefix==="string"&&/^[A-Z0-9]{8}$/.test(activation.public_prefix)?activation.public_prefix:"";
      // The hash travels in the URL fragment, never in an HTTP GET request.
      // On the admin page a user must press "Confirmar acceso" to consume it.
      const safeAccessUrl="https://lirep.360insol.com/"+(activatedPrefix?"?public_prefix="+activatedPrefix:"")+
        "#lirep_login_token="+encodeURIComponent(auth.token_hash)+"&lirep_login_type="+encodeURIComponent(auth.verification_type);
      await onboardingMail(env,row.contact_email,"Acceso administrativo a LIREP",
        '<p>Tu Libro de Reclamaciones está activo.</p><p><a href="'+safeAccessUrl.replace(/&/g,"&amp;")+'">Acceder a LIREP</a></p><p>En la página pulsa «Confirmar acceso». Este enlace es personal y temporal.</p>');
    } catch(error) {
      console.error("LIREP_ONBOARDING_ACCESS_EMAIL",String(error?.message||error));
      return new Response('<!doctype html><html lang="es"><meta charset="utf-8"><main style="font:16px system-ui;max-width:600px;margin:12vh auto;padding:20px"><h1>Empresa activada</h1><p>La activación se completó, pero el correo de acceso no pudo enviarse. No vuelvas a registrar la empresa; solicita un nuevo acceso desde el panel administrativo.</p></main></html>',{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
    }
    return new Response('<!doctype html><html lang="es"><meta charset="utf-8"><main style="font:16px system-ui;max-width:600px;margin:12vh auto;padding:20px"><h1>LIREP activado</h1><p>Revisa tu correo y pulsa «Acceder a LIREP». En la página de acceso confirma el ingreso. WordPress actualizará el estado de la empresa automáticamente.</p></main></html>',{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer"}});
  }
  const status=typeof input.status_token==="string"?input.status_token:"";
  if(!/^[a-f0-9]{64}$/.test(status)||await onboardingHash(status)!==row.status_token_hash)
    return json({ok:false,error:"invalid_token"},403);
  if(path==="status")return json({ok:true,state:onboardingState(row)},200);
  if(path==="cancel"){
    if(row.state==="active")return json({ok:false,error:"review_required"},409);
    await onboardingDb(env,"lirep_onboarding_requests?id=eq."+id+"&state=eq.pending","PATCH",{state:"cancelled",updated_at:new Date().toISOString()});
    return json({ok:true,state:{state:"cancelled"}});
  }
  if(row.expires_at<=new Date().toISOString()||row.state!=="pending")
    return json({ok:false,error:"expired"},409);
  if(row.domain_verified_at)return json({ok:true,state:onboardingState(row)});
  if(onboardingUrl(row.hostname,input.challenge_url)!==row.challenge_url)
    return json({ok:false,error:"invalid_domain"},400);
  // Explicitly disallow redirects, non-HTTPS, oversized responses and nonmatching challenges.
  const challengeResponse=await fetch(row.challenge_url,{method:"GET",redirect:"manual",
    headers:{Accept:"application/json"},signal:AbortSignal.timeout(10000)});
  if(!challengeResponse.ok||challengeResponse.status!==200)return json({ok:false,error:"domain_challenge_failed"},400);
  const challengeText=await challengeResponse.text();
  if(challengeText.length>1024)return json({ok:false,error:"domain_challenge_failed"},400);
  let challengeData;try{challengeData=JSON.parse(challengeText);}catch{return json({ok:false,error:"domain_challenge_failed"},400);}
  if(typeof challengeData.challenge!=="string"||await onboardingHash(challengeData.challenge)!==row.challenge_hash)
    return json({ok:false,error:"domain_challenge_failed"},400);
  await onboardingDb(env,"lirep_onboarding_requests?id=eq."+id+"&state=eq.pending","PATCH",{domain_verified_at:new Date().toISOString()});
  const emailToken=onboardingRandom();
  await onboardingDb(env,"lirep_onboarding_requests?id=eq."+id,"PATCH",{email_token_hash:await onboardingHash(emailToken)});
  const link=new URL("/api/v1/onboarding/confirm",url.origin);
  link.searchParams.set("id",id);link.searchParams.set("token",emailToken);
  try {
    await onboardingMail(env,row.contact_email,"Confirma la activación de LIREP",
      '<p>Se solicitó registrar un Libro de Reclamaciones para '+row.hostname+'.</p><p>Si autorizas esta operación, abre el enlace y confirma:</p><p><a href="'+link.href.replace(/&/g,"&amp;")+'">Confirmar correo y activar LIREP</a></p><p>Si no solicitaste el registro, ignora este mensaje.</p>');
  } catch {
    await onboardingDb(env,"lirep_onboarding_requests?id=eq."+id+"&state=eq.pending","PATCH",{domain_verified_at:null});
    return json({ok:false,error:"email_send_failed"},503);
  }
  return json({ok:true,state:{...onboardingState(row),domain_verified:true},notice:"email_sent"});
}

async function callSupabase(payload, env) {
  const endpoint =
    env.SUPABASE_URL.replace(/\/$/, "") +
    "/rest/v1/rpc/lirep_submit_public_complaint_gateway";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = String(body?.message || "");

    if (message.includes("LIREP_IDEMPOTENCY_KEY_REUSED")) {
      return { error: "IDEMPOTENCY_CONFLICT", status: 409 };
    }
    if (
      message.includes("NOT_AVAILABLE") ||
      message.includes("INVALID_PUBLIC_PREFIX")
    ) {
      return { error: "FORM_NOT_AVAILABLE", status: 404 };
    }

    return { error: "SUBMISSION_FAILED", status: 422 };
  }

  const row = Array.isArray(body) ? body[0] : body;
  if (!row?.public_code) return { error: "INVALID_BACKEND_RESPONSE", status: 502 };

  return {
    status: 201,
    data: {
      public_code: row.public_code,
      sequence_number: row.sequence_number,
      submitted_at: row.submitted_at,
      response_due_at: row.response_due_at,
      duplicate: Boolean(row.duplicate),
    },
  };
}


/* QA230: únicamente comunicaciones oficiales aprobadas.
 * Los reintentos son idempotentes ante Resend; los envíos ambiguos en estado
 * 'sending' nunca se reclaman nuevamente de forma automática.
 */
/* QA249 — approved LIREP corporate HTML identity for official response only.
 * This changes FUTURE emails; never re-queues nor changes approved responses.
 * The outgoing subject/recipient/idempotency key remain unmodified.
 */
function renderLIREPOfficialResponseEmail({company_name,public_code,body}) {
  const company=String(company_name||"Proveedor").slice(0,180);
  const code=displayComplaintCode(public_code);
  const response=String(body||"").trim();
  const safeCompany=escHtml(company),safeCode=escHtml(code);
  const safeResponse=escHtml(response).replace(/\r?\n/g,"<br>");
  const html='<!doctype html><html lang="es"><head><meta charset="UTF-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Respuesta oficial · LIREP</title></head>'+
    '<body style="margin:0;padding:24px 10px;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#18283e;">'+
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;border-collapse:collapse;">'+
    '<tr><td style="padding:24px 28px;background:#142640;border-radius:12px 12px 0 0;color:#ffffff;">'+
    '<div style="font-size:23px;font-weight:700;letter-spacing:.3px;">LIREP</div>'+
    '<div style="font-size:12px;margin-top:6px;color:#dae4f2;">Libro de Reclamaciones Virtual</div></td></tr>'+
    '<tr><td style="background:#fff;padding:30px 28px;border:1px solid #dfe6ed;">'+
    '<h1 style="font-size:21px;line-height:1.35;color:#142640;margin:0 0 20px;">Respuesta oficial a su reclamación</h1>'+
    '<p style="margin:0 0 9px;font-size:14px;"><strong>Empresa:</strong> '+safeCompany+'</p>'+
    '<p style="margin:0 0 22px;font-size:14px;"><strong>Reclamación:</strong> '+safeCode+'</p>'+
    '<div style="padding:20px;border-left:4px solid #142640;background:#f3f6fa;border-radius:5px;line-height:1.7;font-size:15px;">'+
    safeResponse+'</div>'+
    '<p style="font-size:14px;line-height:1.7;margin:23px 0 0;">La respuesta ha sido aprobada y comunicada por la empresa. Conserve este correo como constancia.</p>'+
    '<p style="font-size:13px;line-height:1.65;color:#475569;margin:12px 0 0;">El expediente podrá cerrarse administrativamente después de 15 días calendario desde el envío, si la entrega está acreditada y no existe una disconformidad pendiente. Este cierre no restringe sus derechos como consumidor ni las vías de atención ante las autoridades competentes.</p>'+
    '</td></tr>'+
    '<tr><td style="background:#e9eef5;padding:20px 28px;border-radius:0 0 12px 12px;color:#52667e;font-size:12px;line-height:1.6;">'+
    '<strong style="color:#142640;">360 Integral Solutions · LIREP</strong><br>'+
    'Mensaje automático. Para consultas o disconformidades, comuníquese con la empresa por sus canales habituales. No responda a este remitente.'+
    '</td></tr></table></body></html>';
  const text='LIREP · Libro de Reclamaciones Virtual\n'+
    'Respuesta oficial a su reclamación\n\n'+
    'Empresa: '+company+'\nReclamación: '+code+'\n\n'+
    response+'\n\nLa respuesta ha sido aprobada y comunicada por la empresa. Conserve este correo como constancia.\n'+
    'El expediente podrá cerrarse administrativamente después de 15 días calendario desde el envío, si la entrega está acreditada y no existe una disconformidad pendiente. Este cierre no restringe sus derechos como consumidor.\n'+
    'Para consultas o disconformidades, comuníquese con la empresa por sus canales habituales.\n\n'+
    '360 Integral Solutions · LIREP\nMensaje automático. No responda a este remitente.';
  return {html,text,code};
}

async function autoCloseDueLIREPComplaints(env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return {status:"configuration_missing"};
  try{
    const result=await lirepRpc("lirep_internal_auto_close_due",{p_limit:50},env);
    console.info("LIREP_AUTO_CLOSE_CHECK",Number(result?.closed_count||0));
    return result;
  }catch(error){
    // No consumer identifiers or secrets in logs.
    console.error("LIREP_AUTO_CLOSE_FAILED",String(error?.message||"RPC_FAILED").slice(0,90));
    return {status:"error"};
  }
}

async function deliverApprovedResponses(env, specific = null) {
  if (!env.RESEND_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("LIREP_CRON_DELIVERY_MISSING_BINDING");
    return {status:"configuration_missing"};
  }
  console.info("LIREP_CRON_DELIVERY_START");
  for (let i = 0; i < (specific?1:5); i++) {
    let job;
    try {
      job = specific
        ? await lirepRpc("lirep_admin_response_delivery_claim_one", {
            p_organization_id: specific.organizationId,
            p_response_id: specific.responseId
          }, env)
        : await lirepRpc("lirep_admin_response_delivery_claim", {}, env);
    } catch (error) {
      console.error("LIREP_RESPONSE_CLAIM_FAILED", String(error?.message || "RPC_FAILED").slice(0,100));
      return {status:"claim_error"};
    }
    if (!job) {
      console.info("LIREP_CRON_DELIVERY_NO_DUE_JOB");
      return {status:"not_pending"};
    }
    console.info("LIREP_CRON_DELIVERY_CLAIMED");
    let providerAccepted = false;
    try {
      if (!isUuid(job.queue_id) || !isUuid(job.response_id) ||
          !isEmail(job.recipient) || !job.public_code ||
          typeof job.body !== "string" || job.body.length < 10) {
        throw Object.assign(new Error("LIREP_RESPONSE_JOB_INVALID"), { retryable: false });
      }
      const {html,text:plain,code}=renderLIREPOfficialResponseEmail(job);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.RESEND_API_KEY,
          "content-type": "application/json",
          "Idempotency-Key": "lirep-response-" + job.response_id
        },
        body: JSON.stringify({
          from: "LIREP <notificaciones@360insol.com>",
          to: [job.recipient],
          subject: "Respuesta a su reclamación " + code,
          html,
          text: plain
        }),
        signal: AbortSignal.timeout(15000)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.id) {
        // 429 y 5xx son reintentables con la MISMA clave de idempotencia.
        const error = new Error("RESEND_" + response.status);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      providerAccepted = true;
      console.info("LIREP_CRON_DELIVERY_PROVIDER_ACCEPTED");
      await lirepRpc("lirep_admin_response_delivery_complete", {
        p_queue_id: job.queue_id,
        p_success: true,
        p_provider_message_id: result.id,
        p_error: null,
        p_retryable: false
      }, env);
      if (specific) return {status:"accepted"};
    } catch (error) {
      if (providerAccepted) {
        // Nunca declarar fallo del correo cuando Resend ya lo aceptó:
        // requiere conciliación del registro, sin reenviar.
        console.error("LIREP_RESPONSE_ACCEPTED_RECORD_PENDING", job.queue_id);
        if (specific) return {status:"accepted_reconciliation_pending"};
        continue;
      }
      const retryable = error?.retryable !== false;
      const safeError = String(error?.message || "EMAIL_UNAVAILABLE").slice(0,150);
      try {
        const completed=await lirepRpc("lirep_admin_response_delivery_complete", {
          p_queue_id: job.queue_id,
          p_success: false,
          p_provider_message_id: null,
          p_error: safeError,
          p_retryable: retryable
        }, env);
        if (specific) return {status:completed?.status||"failed"};
      } catch {
        console.error("LIREP_RESPONSE_FAILURE_RECORD_PENDING", job.queue_id);
        if(specific)return {status:"record_error"};
      }
    }
  }
  return {status:"completed"};
}


/* QA231: verificar el último evento del mensaje en Resend.
 * Solo lee mensajes previamente aceptados; NO los reenvía.
 * "delivered" es confirmación del servidor receptor, no de lectura del usuario.
 */
async function reconcileOfficialResponseEvents(env, specific = null) {
  // QA255: usar credencial separada con acceso de lectura. La clave de envío
  // RESEND_API_KEY permanece restringida y nunca se usa para GET /emails.
  if (!env.RESEND_READ_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return {status:"read_credential_missing"};
  for (let i = 0; i < (specific?1:5); i++) {
    let task;
    try {
      task = specific
        ? await lirepRpc("lirep_admin_response_evidence_claim_one", {
            p_organization_id:specific.organizationId,
            p_response_id:specific.responseId
          }, env)
        : await lirepRpc("lirep_admin_response_evidence_claim", {}, env);
    } catch (error) {
      console.error("LIREP_EVIDENCE_CLAIM_FAILED", String(error?.message||"RPC_FAILED").slice(0,100));
      return {status:"claim_error"};
    }
    if (!task) return {status:"not_due"};
    try {
      if (!isUuid(task.evidence_id) ||
          !task.provider_message_id ||
          typeof task.provider_message_id !== "string" ||
          task.provider_message_id.length > 250 ||
          !isEmail(task.recipient)) {
        throw new Error("LIREP_EVIDENCE_JOB_INVALID");
      }
      const response = await fetch("https://api.resend.com/emails/" +
        encodeURIComponent(task.provider_message_id), {
        method:"GET",
        headers:{Authorization:"Bearer "+env.RESEND_READ_API_KEY,Accept:"application/json"},
        signal:AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error("RESEND_DELIVERY_LOOKUP_"+response.status);
      const details = await response.json().catch(()=>null);
      if (details?.id !== task.provider_message_id ||
          !Array.isArray(details.to) ||
          !details.to.some(to => String(to).trim().toLowerCase() === task.recipient.trim().toLowerCase())) {
        throw new Error("LIREP_EVIDENCE_RECIPIENT_MISMATCH");
      }
      const event=String(details.last_event||"").trim().toLowerCase();
      if (!["sent","received","delivered","opened","clicked","bounced","suppressed",
            "delivery_delayed","failed","complained"].includes(event)) {
        throw new Error("LIREP_EVIDENCE_UNKNOWN_EVENT");
      }
      await lirepRpc("lirep_admin_response_evidence_complete", {
        p_evidence_id:task.evidence_id,
        p_provider_message_id:task.provider_message_id,
        p_last_event:event
      },env);
      if(specific)return {status:"checked",event};
    } catch (error) {
      // La consulta fallida nunca genera correo ni reenvía automáticamente;
      // la próxima revisión se programa desde el último claim SQL.
      console.warn("LIREP_EVIDENCE_LOOKUP_PENDING",task.evidence_id,String(error?.message||"UNKNOWN").slice(0,100));
      if(specific)return {status:"lookup_failed"};
    }
  }
  return {status:"complete"};
}


async function caseTracking(prefix,code,token,env) {
  return await lirepRpc("lirep_public_case_tracking", {
    p_public_prefix:prefix,p_public_code:code,p_access_token:token
  },env);
}
function trackingHtml(d) {
  const names={submitted:"Presentado",in_review:"En atención",responded:"Respuesta comunicada",closed:"Cerrado"};
  const channel=d.official_delivery_method==="postal"?"Carta física":"Correo electrónico";
  const when=v=>v?new Date(v).toLocaleString("es-PE",{timeZone:"America/Lima"}):"—";
  const history=(d.history||[]).map(e=>"<li>"+escHtml(names[e.status]||e.status)+" · "+escHtml(when(e.at))+"</li>").join("");
  const communications=(d.communications||[]).map(e=>{
    const state= e.channel==="postal"
      ? ({sent:"Carta despachada (pendiente de recepción)",delivered:"Entrega física registrada con referencia",failed:"Carta devuelta"})[e.status]
      : ({sent:"Correo aceptado (entrega no confirmada)",delivered:"Correo entregado",failed:"Entrega fallida",delayed:"Entrega demorada",complained:"Rechazado como spam"})[e.status];
    return "<li>"+escHtml(state||"Comunicación en seguimiento")+" · "+escHtml(when(e.delivered_at||e.sent_at))+"</li>";
  }).join("");
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Seguimiento LIREP</title><style>body{font:16px system-ui;background:#f5f7fa;color:#18253d;margin:0;padding:24px}.card{max-width:780px;margin:auto;background:#fff;padding:26px;border-radius:12px;border:1px solid #d9e1eb}h1{font-size:1.6rem}h2{font-size:1.1rem}li{margin:10px 0}.box{background:#f1f5f9;padding:15px;border-radius:8px}small{color:#596579}</style></head><body><main class="card"><h1>Seguimiento de reclamación</h1><p class="box"><b>Código:</b> '+escHtml(displayComplaintCode(d.code))+'<br><b>Estado:</b> '+escHtml(names[d.status]||d.status)+'<br><b>Registro:</b> '+escHtml(when(d.submitted_at))+'<br><b>Vencimiento:</b> '+escHtml(when(d.due_at))+'<br><b>Respuesta formal:</b> '+escHtml(channel)+'</p><h2>Historial de estados</h2><ol>'+history+'</ol><h2>Comunicaciones oficiales</h2><ol>'+(communications||'<li>Aún no hay entrega de respuesta registrada.</li>')+'</ol><small>Esta página muestra el seguimiento sin exponer datos personales ni notas internas. La aceptación de un correo no prueba que haya sido entregado o leído.</small></main></body></html>';
}
// QA244: authenticate the signed-in administrator, never a supplied company name.
// The caller's JWT determines membership and role; a service-role client is not
// used for this authorization lookup.
async function authorizedDeliveryAdmin(jwt, organizationId, env) {
  if (!env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_URL) return false;
  const response=await fetch(env.SUPABASE_URL.replace(/\/$/,"")+"/rest/v1/rpc/lirep_admin_my_organizations",{
    method:"POST",
    headers:{
      "apikey":env.SUPABASE_PUBLISHABLE_KEY,
      "authorization":"Bearer "+jwt,
      "content-type":"application/json",
      "accept":"application/json"
    },
    body:"{}",
    signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) return false;
  const organizations=await response.json().catch(()=>null);
  return Array.isArray(organizations)&&organizations.some(o=>
    o?.id===organizationId&&["company_admin","platform_admin"].includes(o.role));
}

export default {
  async scheduled(event, env, ctx) {
    // Markers contain no consumer data: diagnose scheduled invocation vs queue failures.
    console.info("LIREP_CRON_INVOKED", String(event?.cron || "unknown"));
    ctx.waitUntil(reconcileOfficialResponseEvents(env).catch(()=>console.error("LIREP_EVIDENCE_CRON_FAILED")));

    ctx.waitUntil(deliverApprovedResponses(env).catch(() => console.error("LIREP_RESPONSE_SCHEDULER_FAILED")));

    ctx.waitUntil(autoCloseDueLIREPComplaints(env).catch(() => console.error("LIREP_AUTO_CLOSE_SCHEDULER_FAILED")));

    ctx.waitUntil((async () => {
      if (!env.RESEND_API_KEY) return;
      for (let i = 0; i < 5; i++) {
        const discoveryRpc = env.LIREP_ENABLE_MULTIEMPRESA_EMAIL === "true"
          ? "lirep_next_pending_receipt_id_multiempresa"
          : "lirep_next_pending_receipt_id";
        const id = await lirepRpc(discoveryRpc, {}, env);
        if (!id) break;
        const job = await lirepRpc("lirep_claim_receipt_email_by_id", {p_queue_id:id}, env);
        if (!job) continue;
        const link = "https://lirep-public-api.vidadecanes-peru.workers.dev/constancia?public_prefix=" + encodeURIComponent(job.public_prefix) + "&code=" + encodeURIComponent(job.public_code) + "&token=" + encodeURIComponent(job.receipt_token);
        const html = "<h2>Constancia del Libro de Reclamaciones</h2><p>Tu registro fue recibido.</p><p><b>Codigo:</b> " + escHtml(displayComplaintCode(job.public_code)) + "</p><p><a href='" + escHtml(link) + "'>Ver constancia</a></p><p>Este correo es automatico y no esta supervisado. No responda a este mensaje.</p>";
        let accepted = false;
        try {
          if (!approvedReceiptSender(job.from_email)) throw new Error("EMAIL_SENDER_NOT_APPROVED");
    const response = await fetch("https://api.resend.com/emails", {
            method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"content-type":"application/json"},
            body:JSON.stringify({from:job.from_name+" <"+job.from_email+">",to:[job.recipient],subject:"Constancia del Libro de Reclamaciones - "+displayComplaintCode(job.public_code),html}),
            signal:AbortSignal.timeout(15000)
          });
          const result = await response.json().catch(()=>null);
          if (!response.ok || !result?.id) throw new Error(result?.message || "EMAIL_PROVIDER_FAILED");
          accepted = true;
          await lirepRpc("lirep_complete_receipt_email",{p_queue_id:id,p_success:true,p_provider:"resend",p_provider_message_id:result.id,p_error:null},env);
        } catch(error) {
          if (accepted) { console.error("EMAIL_ACCEPTED_COMPLETION_FAILED",id); continue; }
          await lirepRpc("lirep_complete_receipt_email",{p_queue_id:id,p_success:false,p_provider:"resend",p_provider_message_id:null,p_error:String(error?.message||error)},env).catch(()=>{});
        }
      }
    })());
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if ((url.pathname === "/" || url.pathname === "/libro-de-reclamaciones") && request.method === "GET") {
      return new Response("<!doctype html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Libro de Reclamaciones</title>\n<script>if(new URLSearchParams(location.search).get('embed')==='1')document.documentElement.classList.add('lirep-embed');</script>\n<script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js\" async defer></script>\n<style>\n:root{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#172033;background:#f5f7fa}*{box-sizing:border-box}body{margin:0}.wrap{width:100%;max-width:1240px;margin:0 auto;padding:clamp(12px,2vw,28px)}.card{background:#fff;border:1px solid #dde3ea;border-radius:16px;padding:clamp(16px,2.6vw,36px);box-shadow:0 8px 30px #1720330d}h1{margin:.2em 0;font-size:clamp(1.7rem,4vw,2.4rem)}h2{font-size:1.15rem;margin:28px 0 12px}.muted{color:#5f6b7a}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(12px,1.8vw,22px)}label{display:block;font-weight:650;font-size:.92rem}input,select,textarea{min-width:0;width:100%;margin-top:6px;padding:12px;border:1px solid #cfd7e2;border-radius:10px;font:inherit;background:#fff}textarea{min-height:120px;resize:vertical}.full{grid-column:1/-1}[hidden]{display:none!important}.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin:12px 0 8px;padding:4px 4px}.check input{width:auto;margin-top:4px}button{margin-top:18px;border:0;border-radius:10px;padding:13px 18px;font:inherit;font-weight:750;cursor:pointer;background:#172033;color:#fff}button:disabled{opacity:.55;cursor:not-allowed}.msg{margin-top:16px;padding:14px;border-radius:10px;display:none}.ok{display:block;background:#ecfdf3;color:#166534}.err{display:block;background:#fff1f2;color:#9f1239}.company{padding:12px 0 18px;border-bottom:1px solid #e5e9ef}.badge{display:inline-block;padding:5px 9px;border-radius:999px;background:#eef2f7;font-size:.8rem;font-weight:700}.modal-backdrop{position:fixed;inset:0;background:#0f172acc;display:none;align-items:center;justify-content:center;padding:20px;z-index:9999}.modal-backdrop.open{display:flex}.modal{width:min(520px,100%);background:#fff;border-radius:18px;padding:28px;box-shadow:0 24px 80px #0005;text-align:center}.modal-icon{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;margin:0 auto 14px;background:#ecfdf3;color:#166534;font-size:30px;font-weight:800}.modal h2{margin:0 0 8px;font-size:1.45rem}.modal-code{margin:16px 0;padding:13px;border-radius:10px;background:#f1f5f9;font-weight:800;word-break:break-word}.modal p{color:#5f6b7a}.modal button{width:100%;margin-top:10px}.footer{text-align:center;margin-top:18px;padding:14px 8px;color:#6b7280;font-size:.82rem}@media(max-width:650px){.wrap{padding:12px}.card{padding:18px}.grid{grid-template-columns:1fr}.full{grid-column:auto}}html.lirep-embed,html.lirep-embed body,html.lirep-embed .wrap{background:transparent!important}html.lirep-embed .wrap{width:100%;max-width:1240px}html.lirep-embed .card{background:#fff!important;box-shadow:none}html.lirep-embed .card>.badge{display:none!important}html.lirep-embed .card>h1{text-align:center!important;font-size:clamp(2rem,4vw,2.8rem)!important}\n\n/* QA253 | Solo formulario público; navegación administrativa independiente */\n.lirep-public-form-layout{display:block;width:100%;min-width:0}\n.lirep-public-form-layout>.card{width:100%;min-width:0}\n</style>\n</head>\n<body>\n<main class=\"wrap\"><div class=\"lirep-public-form-layout\"><section class=\"card\">\n<span class=\"badge\">Libro de Reclamaciones Virtual</span>\n<h1 id=\"lirep-step-inicio\">Libro de Reclamaciones</h1>\n<div id=\"company\" class=\"company\"><strong>Consultando datos del establecimiento…</strong><div class=\"muted\">Cargando información del establecimiento…</div></div>\n\n<form id=\"form\" novalidate>\n<h2 id=\"lirep-step-consumidor\">1. Identificación del consumidor</h2>\n<div class=\"grid\">\n<label>Tipo de documento<select name=\"document_type\" required><option value=\"dni\">DNI</option><option value=\"ce\">Carné de extranjería</option><option value=\"passport\">Pasaporte</option><option value=\"ruc\">RUC</option><option value=\"other\">Otro</option></select></label>\n<label>Número de documento<input name=\"document_number\" maxlength=\"50\" required></label>\n<label>Nombres<input name=\"first_names\" maxlength=\"150\" required></label>\n<label>Apellidos<input name=\"last_names\" maxlength=\"150\" required></label>\n<label>Teléfono<input name=\"phone\" type=\"tel\" maxlength=\"30\" required></label>\n<label class=\"full\">Medio para recibir la respuesta escrita<select id=\"officialDeliveryMethod\" name=\"official_delivery_method\" required><option value=\"email\">Correo electrónico</option><option value=\"postal\">Carta al domicilio indicado</option></select></label>\n<label>Correo electrónico para respuesta oficial<input id=\"officialEmail\" name=\"email\" type=\"email\" maxlength=\"254\" autocomplete=\"email\" required></label>\n<p class=\"full muted\" style=\"margin:0\">Si eliges correo, la respuesta oficial se enviará a esta dirección. Si eliges carta, el correo es opcional y debes conservar la constancia de envío o recepción.</p>\n<label class=\"full\">Domicilio<input name=\"address\" maxlength=\"500\" required></label>\n<label class=\"full check\"><input type=\"checkbox\" id=\"is_minor\" name=\"is_minor\"><span>El consumidor es menor de edad</span></label>\n<div id=\"representative\" class=\"full grid\" hidden>\n<label>Nombres del padre, madre o representante<input name=\"representative_first_names\" maxlength=\"150\"></label>\n<label>Apellidos del padre, madre o representante<input name=\"representative_last_names\" maxlength=\"150\"></label>\n<label>Tipo de documento del representante<select name=\"representative_document_type\"><option value=\"dni\">DNI</option><option value=\"ce\">Carné de extranjería</option><option value=\"passport\">Pasaporte</option><option value=\"ruc\">RUC</option><option value=\"other\">Otro</option></select></label>\n<label>Número de documento del representante<input name=\"representative_document_number\" maxlength=\"50\"></label>\n<label>Teléfono del representante<input name=\"representative_phone\" type=\"tel\" maxlength=\"30\"></label>\n<label>Correo del representante para respuesta oficial<input name=\"representative_email\" type=\"email\" maxlength=\"254\" autocomplete=\"email\"></label>\n</div>\n</div>\n\n<h2 id=\"lirep-step-bien\">2. Bien o servicio</h2>\n<div class=\"grid\">\n<label>Tipo<select name=\"product_service_type\" required><option value=\"servicio\">Servicio</option><option value=\"producto\">Producto</option></select></label>\n<label>Monto reclamado (S/)<input name=\"amount\" type=\"number\" min=\"0\" step=\"0.01\"></label>\n<label class=\"full\">Descripción<input name=\"product_service_description\" maxlength=\"1000\" required></label>\n</div>\n\n<h2 id=\"lirep-step-reclamo\">3. Detalle del reclamo o queja</h2>\n<div class=\"grid\">\n<label>Tipo<select name=\"complaint_type\" required><option value=\"reclamo\">Reclamo</option><option value=\"queja\">Queja</option></select></label>\n<label class=\"full\">Detalle<textarea name=\"detail\" maxlength=\"5000\" required></textarea></label>\n<label class=\"full\">Pedido del consumidor<textarea name=\"consumer_request\" maxlength=\"5000\" required></textarea></label>\n<label>Canal preferido de contacto adicional<select name=\"preferred_response_channel\" required><option value=\"whatsapp\">WhatsApp</option><option value=\"phone\">Teléfono</option><option value=\"email\">Correo electrónico</option><option value=\"physical\">Domicilio</option></select></label>\n<p class=\"full muted\" style=\"margin:0\">Este canal es solo para coordinaciones; la respuesta formal se entregará por correo o carta según la elección anterior.</p>\n<label class=\"full check\"><input type=\"checkbox\" name=\"consumer_conformity\" required><span>Declaro que la información consignada es correcta y manifiesto mi conformidad con el registro electrónico y solicito recibir la respuesta formal escrita mediante el correo electrónico o la carta que elegí, aunque prefiera WhatsApp para coordinaciones.</span></label>\n</div>\n\n<section id=\"lirep-step-informacion\" aria-label=\"Información legal y datos personales\" style=\"margin:20px 0;padding:16px;border:1px solid #dbe3ed;border-radius:10px;background:#f8fafc;line-height:1.6\">\n<p><strong>Plazo de respuesta:</strong> Los reclamos y quejas deben ser atendidos y respondidos en un plazo máximo de <strong>15 días hábiles improrrogables</strong>, conforme a la normativa peruana vigente.</p>\n<p><strong>Protección de datos personales:</strong> La información proporcionada se utilizará para registrar, tramitar y responder esta reclamación y cumplir las obligaciones legales aplicables. <span id=\"lirep-privacy-info\">La empresa responsable del Libro de Reclamaciones tratará los datos proporcionados para atender y responder la solicitud conforme a la normativa aplicable.</span></p>\n</section>\n<div id=\"lirep-step-enviar\" class=\"cf-turnstile\" data-sitekey=\"0x4AAAAAAFQZXPjiJUTwSZmi\"></div>\n<button id=\"submit\" type=\"submit\">Registrar reclamo o queja</button>\n<div id=\"message\" class=\"msg\" role=\"status\" aria-live=\"polite\"></div>\n</form>\n</section></div><div id=\"successModal\" class=\"modal-backdrop\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"successTitle\"><div class=\"modal\"><div class=\"modal-icon\">✓</div><h2 id=\"successTitle\">Registro realizado correctamente</h2><p>Tu reclamo o queja fue registrado. Conserva este código como constancia:</p><div id=\"successCode\" class=\"modal-code\"></div><button id=\"receiptButton\" type=\"button\">Ver / descargar constancia</button><button id=\"trackingButton\" type=\"button\">Consultar seguimiento</button><button id=\"closeSuccessModal\" type=\"button\">Entendido</button></div></div><footer class=\"footer\">&copy; <span id=\"copyright-year\"></span> · Powered by 360 Integral Solutions</footer></main>\n<script>\ndocument.getElementById(\"copyright-year\").textContent=new Date().getFullYear();\nconst API=location.origin;\nconst PREFIX=(new URLSearchParams(location.search).get(\"public_prefix\")||\"\").trim().toUpperCase();\nif(!/^[A-Z0-9]{8}$/.test(PREFIX)){document.body.innerHTML=\"<main class=\\\"wrap\\\"><section class=\\\"card\\\"><h1>Libro no disponible</h1><p class=\\\"muted\\\">Falta la identificación segura de la empresa. No se realizará ningún registro.</p></section></main>\";throw new Error(\"PUBLIC_PREFIX_REQUIRED\");}\nlet establishmentCode=null,bookCode=null,idempotencyKey=null;\nif(PREFIX===\"LIREPQA1\"){const qa=document.createElement(\"div\");qa.style.cssText=\"margin:10px 0;padding:10px;border-radius:10px;background:#fff7ed;color:#9a3412;font-weight:800;text-align:center\";qa.textContent=\"ENTORNO QA · LOS REGISTROS DE ESTA PÁGINA SON DE PRUEBA\";document.querySelector(\".card\").prepend(qa);}\nconst company=document.getElementById(\"company\"),form=document.getElementById(\"form\"),message=document.getElementById(\"message\"),submit=document.getElementById(\"submit\"),successModal=document.getElementById(\"successModal\"),successCode=document.getElementById(\"successCode\"),closeSuccessModal=document.getElementById(\"closeSuccessModal\");\nlet lastPublicCode=\"\",lastReceiptToken=\"\";\nconst receiptButton=document.getElementById(\"receiptButton\"),trackingButton=document.getElementById(\"trackingButton\");\ntrackingButton.addEventListener(\"click\",()=>{if(lastPublicCode&&lastReceiptToken)window.open(API+\"/seguimiento?public_prefix=\"+encodeURIComponent(PREFIX)+\"&code=\"+encodeURIComponent(lastPublicCode)+\"&token=\"+encodeURIComponent(lastReceiptToken),\"_blank\",\"noopener\");});\nreceiptButton.addEventListener(\"click\",()=>{if(lastPublicCode&&lastReceiptToken)window.open(API+\"/constancia?public_prefix=\"+encodeURIComponent(PREFIX)+\"&code=\"+encodeURIComponent(lastPublicCode)+\"&token=\"+encodeURIComponent(lastReceiptToken),\"_blank\",\"noopener\");});\ncloseSuccessModal.addEventListener(\"click\",()=>successModal.classList.remove(\"open\"));\nsuccessModal.addEventListener(\"click\",e=>{if(e.target===successModal)successModal.classList.remove(\"open\");});\n\nfunction uuid(){return crypto.randomUUID();}\nconst minor=document.getElementById(\"is_minor\"),representative=document.getElementById(\"representative\");\nconst officialMethod=document.getElementById(\"officialDeliveryMethod\");\nfunction syncOfficialDelivery(){\n const email=officialMethod.value===\"email\";\n form.elements.email.required=email&&!minor.checked;\n const rep=form.elements.representative_email;\n rep.required=email&&minor.checked;\n}\nfunction syncMinorFields(){\n representative.hidden=!minor.checked;\n representative.querySelectorAll(\"input,select\").forEach(el=>{\n  el.disabled=!minor.checked;\n  if([\"representative_first_names\",\"representative_last_names\",\"representative_document_type\",\"representative_document_number\"].includes(el.name))el.required=minor.checked;\n });\n syncOfficialDelivery();\n}\nofficialMethod.addEventListener(\"change\",syncOfficialDelivery);\nminor.addEventListener(\"change\",syncMinorFields);\nsyncMinorFields();\nfunction show(text,type){message.className=\"msg \"+type;message.textContent=text;}\nasync function loadConfig(){\n try{\n  const r=await fetch(API+\"/api/v1/form-config?public_prefix=\"+PREFIX);\n  const j=await r.json();\n  if(!r.ok||!j.ok)throw new Error();\n  const e=j.config.establishments?.[0],b=e?.books?.[0];\n  if(!e||!b)throw new Error();\n  establishmentCode=e.code;bookCode=b.code;\n  const org=j.config.organization;\n  const privacyInfo=document.getElementById(\"lirep-privacy-info\");\n  if(privacyInfo){\n   const url=String(org.privacy_policy_url||\"\").trim();\n   privacyInfo.textContent=\"Los datos personales serán tratados por \"+String(org.legal_name||org.trade_name||\"la empresa responsable\")+\" para atender y responder esta reclamación conforme a la normativa aplicable.\";\n   if(/^https:\\/\\//i.test(url)){\n    try{const u=new URL(url);if(u.username===\"\"&&u.password===\"\"&&u.protocol===\"https:\"){const a=document.createElement(\"a\");a.href=u.href;a.target=\"_blank\";a.rel=\"noopener noreferrer\";a.textContent=\" Consultar política de privacidad.\";privacyInfo.appendChild(a);}}catch(_){}\n   }\n  }\n  const displayName=org.trade_name||org.legal_name;\n  document.title=\"Libro de Reclamaciones | \"+String(displayName||\"Empresa\").slice(0,120);\n  const establishmentName=String(e.name||\"\").trim();\n  const normalizedDisplay=String(displayName||\"\").toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g,\" \").trim();\n  const normalizedEst=establishmentName.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g,\" \").trim();\n  const showEstablishment=establishmentName && normalizedEst!==normalizedDisplay && !normalizedEst.startsWith(normalizedDisplay+\" \");\n  company.innerHTML=\"<strong>\"+escapeHtml(displayName)+\"</strong><div class=\\\"muted\\\">\"+(showEstablishment?escapeHtml(establishmentName)+\" · \":\"\")+escapeHtml([e.district,e.province,e.department].filter(Boolean).join(\", \"))+\"</div>\";\n }catch{submit.disabled=true;show(\"El Libro de Reclamaciones no está disponible temporalmente. Intenta nuevamente más tarde.\",\"err\");}\n}\nfunction escapeHtml(v){const d=document.createElement(\"div\");d.textContent=String(v||\"\");return d.innerHTML;}\nform.addEventListener(\"submit\",async(e)=>{\n e.preventDefault();message.className=\"msg\";\n if(!form.reportValidity()||!establishmentCode||!bookCode)return;\n const fd=new FormData(form),token=fd.get(\"cf-turnstile-response\");\n if(!token){show(\"Completa la verificación de seguridad.\",\"err\");return;}\n submit.disabled=true;\n const body={\n  idempotency_key:(idempotencyKey||(idempotencyKey=uuid())),public_prefix:PREFIX,establishment_code:establishmentCode,book_code:bookCode,\n  document_type:fd.get(\"document_type\"),document_number:fd.get(\"document_number\"),first_names:fd.get(\"first_names\"),\n  last_names:fd.get(\"last_names\"),email:fd.get(\"email\"),phone:fd.get(\"phone\"),address:fd.get(\"address\"),is_minor:fd.get(\"is_minor\")===\"on\",\n  representative_first_names:fd.get(\"representative_first_names\")||null,representative_last_names:fd.get(\"representative_last_names\")||null,\n  representative_document_type:fd.get(\"representative_document_type\")||null,representative_document_number:fd.get(\"representative_document_number\")||null,\n  representative_phone:fd.get(\"representative_phone\")||null,representative_email:fd.get(\"representative_email\")||null,\n  consumer_conformity:fd.get(\"consumer_conformity\")===\"on\",official_delivery_method:fd.get(\"official_delivery_method\"),preferred_response_channel:fd.get(\"preferred_response_channel\"),complaint_type:fd.get(\"complaint_type\"),\n  product_service_type:fd.get(\"product_service_type\"),product_service_description:fd.get(\"product_service_description\"),\n  amount:fd.get(\"amount\"),detail:fd.get(\"detail\"),consumer_request:fd.get(\"consumer_request\"),turnstile_token:token\n };\n try{\n  const r=await fetch(API+\"/api/v1/complaints?public_prefix=\"+encodeURIComponent(PREFIX),{method:\"POST\",headers:{\"Content-Type\":\"application/json\",\"X-LIREP-Prefix\":PREFIX},body:JSON.stringify(body)});\n  const j=await r.json();\n  if(!r.ok||!j.ok)throw new Error(j.error||\"SUBMISSION_FAILED\");\n  const c=j.complaint;\n  lastPublicCode=c.public_code;lastReceiptToken=c.receipt_token||\"\";receiptButton.hidden=!lastReceiptToken;trackingButton.hidden=!lastReceiptToken;successCode.textContent=String(c.public_code||'').replace(/^[A-Z0-9]{8}-(?=LR[0-9]+-)/,'');successModal.classList.add(\"open\");closeSuccessModal.focus();\n  form.reset();syncMinorFields();syncOfficialDelivery();idempotencyKey=null;if(window.turnstile)turnstile.reset();\n }catch(err){show(\"No se pudo registrar. \"+(err.message===\"TURNSTILE_FAILED\"?\"Repite la verificación de seguridad.\":\"Intenta nuevamente.\"),\"err\");if(window.turnstile)turnstile.reset();}\n finally{submit.disabled=false;}\n});\nloadConfig();\n</script>\n</body></html>".replace("</body></html>", `<script>
(function(){
 if(new URLSearchParams(location.search).get("embed")!=="1" || window.parent===window)return;
 function sendHeight(){
  // The document scrollHeight includes the iframe viewport's minimum height.
  // Measuring it creates a feedback loop: parent grows iframe, document grows again.
  var content=document.body.lastElementChild && document.body.lastElementChild.tagName!=="SCRIPT" ? document.body.lastElementChild : document.querySelector("footer")||document.querySelector(".wrap")||document.querySelector("main");
  if(!content)return;
  var rect=content.getBoundingClientRect();
  var height=Math.ceil(rect.bottom+window.scrollY+24);
  if(Number.isFinite(height)&&height>0)window.parent.postMessage({type:"lirep:resize",height:height,prefix:new URLSearchParams(location.search).get("public_prefix")},"*");
 }
 var measured=document.querySelector(".wrap")||document.querySelector("main");
 if("ResizeObserver" in window){
  var ro=new ResizeObserver(sendHeight);
  if(measured)ro.observe(measured);
  else ro.observe(document.body);
 }
 if("MutationObserver" in window&&measured)new MutationObserver(sendHeight).observe(measured,{childList:true,subtree:true,attributes:true,attributeFilter:["hidden","style","class"]});
 // WordPress can attach its message listener after the iframe has loaded.
 // A parent handshake re-measures the actual form instead of relying on one first postMessage.
 window.addEventListener("message",function(event){
  if(event.source!==window.parent || !event.data || event.data.type!=="lirep:measure")return;
  sendHeight();
 });
 window.addEventListener("load",sendHeight);
 window.addEventListener("resize",sendHeight);
 document.addEventListener("DOMContentLoaded",sendHeight);
 window.setTimeout(sendHeight,150);
 window.setTimeout(sendHeight,500);
 window.setTimeout(sendHeight,1500);
 window.setTimeout(sendHeight,3500);
 sendHeight();
})();
</script></body></html>`), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      });
    }



    if ((url.pathname==="/seguimiento" || url.pathname==="/api/v1/tracking") && request.method==="GET") {
      const prefix=String(url.searchParams.get("public_prefix")||"").trim().toUpperCase();
      const code=String(url.searchParams.get("code")||"").trim().toUpperCase();
      const token=String(url.searchParams.get("token")||"").trim().toLowerCase();
      const headers={"cache-control":"no-store, private","referrer-policy":"no-referrer","x-content-type-options":"nosniff","x-robots-tag":"noindex, nofollow"};
      if(!/^[A-Z0-9]{8}$/.test(prefix)|| !/^[A-Z0-9-]{10,80}$/.test(code)||!isUuid(token))return json({ok:false,error:"INVALID_TRACKING_REFERENCE"},400,headers);
      try {
        const ip=request.headers.get("CF-Connecting-IP")||"unknown";
        const limited=await env.SUBMIT_RATE_LIMITER.limit({key:"tracking:"+ip});
        if(!limited.success)return json({ok:false,error:"RATE_LIMITED"},429,headers);
        const data=await caseTracking(prefix,code,token,env);
        if(!data)return json({ok:false,error:"TRACKING_NOT_FOUND"},404,headers);
        if(url.pathname==="/api/v1/tracking")return json({ok:true,tracking:data},200,headers);
        return new Response(trackingHtml(data),{status:200,headers:{...headers,"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
      }catch(error){console.error("LIREP_TRACKING_READ_FAILED",String(error?.message||"").slice(0,80));return json({ok:false,error:"SERVICE_UNAVAILABLE"},503,headers)}
    }

    if (url.pathname === "/constancia" && request.method === "GET") {
      const publicPrefix=String(url.searchParams.get("public_prefix")||"").trim().toUpperCase();
      const publicCode=String(url.searchParams.get("code")||"").trim().toUpperCase();
      const accessToken=String(url.searchParams.get("token")||"").trim().toLowerCase();
      if(!/^[A-Z0-9]{8}$/.test(publicPrefix) || !/^[A-Z0-9-]{10,80}$/.test(publicCode) || !isUuid(accessToken)) return json({ok:false,error:"INVALID_RECEIPT_REFERENCE"},400);
      try{
        const data=await receiptData(publicPrefix,publicCode,accessToken,env);
        if(!data) return json({ok:false,error:"RECEIPT_NOT_FOUND"},404);
        const trackingLink="/seguimiento?public_prefix="+encodeURIComponent(publicPrefix)+"&code="+encodeURIComponent(publicCode)+"&token="+encodeURIComponent(accessToken);
        const paper=receiptHtml(data).replace("<div class=\"actions\"><button","<div class=\"actions\"><a href=\""+escHtml(trackingLink)+"\">Consultar estado</a> &nbsp; <button");
        return new Response(paper,{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'"}});
      }catch{return json({ok:false,error:"SERVICE_UNAVAILABLE"},503);}
    }

    if (url.pathname.startsWith(onboardingBase)) {
      try { return await onboardingRoute(request,env,url); }
      catch (error) { console.error("ONBOARDING_ERROR",String(error?.message||error)); return json({ok:false,error:"onboarding_not_configured"},503); }
    }


    if (url.pathname==="/api/v1/admin/response-delivery/process" ||
        url.pathname==="/api/v1/admin/response-delivery/refresh") {
      const checkProvider=url.pathname.endsWith("/refresh");
      const origin=request.headers.get("origin")||"";
      if(origin!=="https://lirep.360insol.com")return json({ok:false,error:"ORIGIN_NOT_ALLOWED"},403);
      const headers={
        "Access-Control-Allow-Origin":origin,
        "Access-Control-Allow-Methods":"POST,OPTIONS",
        "Access-Control-Allow-Headers":"authorization,content-type",
        "Vary":"Origin",
        "Cache-Control":"no-store"
      };
      if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
      if(request.method!=="POST")return json({ok:false,error:"METHOD_NOT_ALLOWED"},405,headers);
      const size=Number(request.headers.get("content-length")||0);
      if(size>4096)return json({ok:false,error:"PAYLOAD_TOO_LARGE"},413,headers);
      const auth=/^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization")||"");
      if(!auth||auth[1].length<100||auth[1].length>8192)
        return json({ok:false,error:"AUTH_REQUIRED"},401,headers);
      const ip=request.headers.get("CF-Connecting-IP")||"unknown";
      const rate=await env.SUBMIT_RATE_LIMITER.limit({
        key:(checkProvider?"admin-evidence:":"admin-delivery:")+ip
      });
      if(!rate.success)return json({ok:false,error:"RATE_LIMITED"},429,headers);
      let payload;
      try{payload=await request.json()}catch{return json({ok:false,error:"INVALID_JSON"},400,headers)}
      const organizationId=payload?.organization_id,responseId=payload?.response_id;
      if(!isUuid(organizationId)||!isUuid(responseId))
        return json({ok:false,error:"INVALID_RESPONSE_REFERENCE"},400,headers);
      try{
        const authorized=await authorizedDeliveryAdmin(auth[1],organizationId,env);
        if(!authorized)return json({ok:false,error:"ADMIN_ACCESS_DENIED"},403,headers);
        const result=checkProvider
          ? await reconcileOfficialResponseEvents(env,{organizationId,responseId})
          : await deliverApprovedResponses(env,{organizationId,responseId});
        return json({ok:true,status:result?.status||"unknown",
          ...(checkProvider&&result?.event?{event:result.event}:{})},200,headers);
      }catch(error){
        console.error("LIREP_ADMIN_DELIVERY_PROCESS_FAILED",String(error?.message||"").slice(0,90));
        return json({ok:false,error:"SERVICE_UNAVAILABLE"},503,headers);
      }
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "lirep-public-api", version: "1.13.8" });
    }

    if (url.pathname === "/health/backend" && request.method === "GET") {
      const result = await supabaseConnectivity(env);
      return result.ok
        ? json({ ok: true, service: "lirep-public-api", version: "1.13.8", backend: "supabase", connected: true })
        : json({ ok: false, service: "lirep-public-api", version: "1.13.8", backend: "supabase", connected: false, error: result.error }, 503);
    }

    if (url.pathname === "/api/v1/form-config" && request.method === "GET") {
      const requestOrigin = request.headers.get("Origin");
      const publicPrefix = String(url.searchParams.get("public_prefix") || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(publicPrefix)) {
        return json({ ok: false, error: "INVALID_PUBLIC_PREFIX" }, 400);
      }
      let corsHeaders = {};
      if (requestOrigin) {
        const selfOrigin = new URL(request.url).origin;
        const allowed = requestOrigin === selfOrigin || await originAllowedForPrefix(requestOrigin, publicPrefix, env);
        if (!allowed) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
        corsHeaders = corsForOrigin(requestOrigin);
      }

      try {
        const response = await fetch(
          env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/lirep_public_form_config",
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              "content-type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ p_public_prefix: publicPrefix }),
            signal: AbortSignal.timeout(10000),
          },
        );

        const body = await response.json().catch(() => null);
        if (!response.ok) return json({ ok: false, error: "FORM_NOT_AVAILABLE" }, 404, corsHeaders);
        return json({ ok: true, config: body }, 200, corsHeaders);
      } catch {
        return json({ ok: false, error: "SERVICE_UNAVAILABLE" }, 503, corsHeaders);
      }
    }

    if (url.pathname !== "/api/v1/complaints") {
      return json({ ok: false, error: "NOT_FOUND" }, 404);
    }

    const requestOrigin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      const requestedPrefix = String(request.headers.get("X-LIREP-Prefix") || url.searchParams.get("public_prefix") || "").trim().toUpperCase();
      const selfOrigin = new URL(request.url).origin;
      const allowed = requestOrigin && (requestOrigin === selfOrigin || (/^[A-Z0-9]{8}$/.test(requestedPrefix) && await originAllowedForPrefix(requestOrigin, requestedPrefix, env)));
      if (!allowed) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
      return new Response(null, { status: 204, headers: corsForOrigin(requestOrigin) });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    let corsHeaders = {};
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > 32768) {
      return json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413, corsHeaders);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rate = await env.SUBMIT_RATE_LIMITER.limit({ key: ip });
    if (!rate.success) {
      return json({ ok: false, error: "RATE_LIMITED" }, 429, corsHeaders);
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return json({ ok: false, error: "INVALID_JSON" }, 400, corsHeaders);
    }

    const bodyPrefix = typeof input.public_prefix === "string" ? input.public_prefix.trim().toUpperCase() : "";
    const queryPrefix = String(url.searchParams.get("public_prefix") || "").trim().toUpperCase();
    const headerPrefix = String(request.headers.get("X-LIREP-Prefix") || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(bodyPrefix) ||
        (queryPrefix && queryPrefix !== bodyPrefix) ||
        (headerPrefix && headerPrefix !== bodyPrefix)) {
      return json({ ok: false, error: "TENANT_PREFIX_MISMATCH" }, 409);
    }
    const originPrefix = bodyPrefix;
    const selfOrigin = new URL(request.url).origin;
    const originAllowed = requestOrigin && (requestOrigin === selfOrigin || (/^[A-Z0-9]{8}$/.test(originPrefix) && await originAllowedForPrefix(requestOrigin, originPrefix, env)));
    if (!originAllowed) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
    corsHeaders = corsForOrigin(requestOrigin);

    const turnstileToken = input.turnstile_token;
    const turnstileOk = await verifyTurnstile(turnstileToken, request, env);
    if (!turnstileOk) {
      return json({ ok: false, error: "TURNSTILE_FAILED" }, 403, corsHeaders);
    }

    const idempotencyKey = requiredString(input.idempotency_key, 36);
    const publicPrefix = requiredString(input.public_prefix, 12);
    const establishmentCode = requiredString(input.establishment_code, 50);
    const bookCode = requiredString(input.book_code, 50);
    const documentNumber = requiredString(input.document_number, 50);
    const firstNames = requiredString(input.first_names, 150);
    const lastNames = requiredString(input.last_names, 150);
    const phone = requiredString(input.phone, 30);
    const address = requiredString(input.address, 500);
    const detail = requiredString(input.detail, 5000);
    const consumerRequest = requiredString(input.consumer_request, 5000);

    if (
      !idempotencyKey ||
      !publicPrefix ||
      !establishmentCode ||
      !bookCode ||
      !documentNumber ||
      !firstNames ||
      !lastNames ||
      !phone ||
      !address ||
      !detail ||
      !consumerRequest
    ) {
      return json({ ok: false, error: "VALIDATION_ERROR" }, 400, corsHeaders);
    }

    const documentTypes = new Set(["dni", "ce", "passport", "ruc", "other"]);
    const complaintTypes = new Set(["reclamo", "queja"]);
    const normalizedPrefix = publicPrefix.toUpperCase();
    const email =
      typeof input.email === "string" && input.email.trim()
        ? input.email.trim().slice(0, 254)
        : null;
    const deliveryMethod = input.official_delivery_method;
    const representativeEmail = typeof input.representative_email==="string"&&input.representative_email.trim()?input.representative_email.trim():null;

    if (
      !isUuid(idempotencyKey) ||
      !/^[A-Z0-9]{8}$/.test(normalizedPrefix) ||
      !documentTypes.has(input.document_type) ||
      !complaintTypes.has(input.complaint_type) ||
      (email!==null && !isEmail(email)) ||
      !["email","postal"].includes(deliveryMethod) ||
      (representativeEmail!==null && !isEmail(representativeEmail)) ||
      (deliveryMethod==="email" && !isEmail(input.is_minor===true?representativeEmail:email)) ||
      input.consumer_conformity !== true ||
      !["email","phone","physical","whatsapp"].includes(input.preferred_response_channel) ||
      (input.is_minor === true && (!requiredString(input.representative_first_names,150) || !requiredString(input.representative_last_names,150) || !documentTypes.has(input.representative_document_type) || !requiredString(input.representative_document_number,50)))
    ) {
      return json({ ok: false, error: "VALIDATION_ERROR" }, 400, corsHeaders);
    }

    const payload = {
      p_idempotency_key: idempotencyKey,
      p_public_prefix: normalizedPrefix,
      p_establishment_code: establishmentCode,
      p_book_code: bookCode,
      p_document_type: input.document_type,
      p_document_number: documentNumber,
      p_first_names: firstNames,
      p_last_names: lastNames,
      p_email: email,
      p_phone: phone,
      p_address: address,
      p_is_minor: input.is_minor === true,
      p_representative_first_names: typeof input.representative_first_names==="string"?input.representative_first_names.trim().slice(0,150):null,
      p_representative_last_names: typeof input.representative_last_names==="string"?input.representative_last_names.trim().slice(0,150):null,
      p_representative_document_type: input.is_minor===true?input.representative_document_type:null,
      p_representative_document_number: typeof input.representative_document_number==="string"?input.representative_document_number.trim().slice(0,50):null,
      p_representative_phone: typeof input.representative_phone==="string"?input.representative_phone.trim().slice(0,30):null,
      p_representative_email: typeof input.representative_email==="string"&&input.representative_email.trim()?input.representative_email.trim().slice(0,254):null,
      p_complaint_type: input.complaint_type,
      p_product_service_type:
        typeof input.product_service_type === "string"
          ? input.product_service_type.trim().slice(0, 100)
          : null,
      p_product_service_description:
        typeof input.product_service_description === "string"
          ? input.product_service_description.trim().slice(0, 1000)
          : null,
      p_amount:
        input.amount === null || input.amount === "" || input.amount === undefined
          ? null
          : Number(input.amount),
      p_detail: detail,
      p_consumer_request: consumerRequest,
      p_consumer_conformity: true,
      p_preferred_response_channel: input.preferred_response_channel,
      p_official_delivery_method: deliveryMethod,
    };

    if (
      payload.p_amount !== null &&
      (!Number.isFinite(payload.p_amount) || payload.p_amount < 0)
    ) {
      return json({ ok: false, error: "INVALID_AMOUNT" }, 400, corsHeaders);
    }

    try {
      const result = await callSupabase(payload, env);
      if (result.error) {
        return json({ ok: false, error: result.error }, result.status, corsHeaders);
      }

      // A committed complaint must never become a 503 because receipt-token issuance fails.
      let receiptToken = null;
      try {
        receiptToken = await lirepRpc("lirep_issue_receipt_token", {p_public_prefix:normalizedPrefix,p_public_code:result.data.public_code}, env);
      } catch (error) {
        console.error("RECEIPT_TOKEN_ISSUANCE_FAILED", result.data.public_code);
      }
      result.data.receipt_token = typeof receiptToken === "string" ? receiptToken : (receiptToken?.access_token || receiptToken?.receipt_token || null);
      ctx.waitUntil(sendSecureReceipt(normalizedPrefix, result.data.public_code, env).catch(()=>{}));
      return json({ ok: true, complaint: result.data }, result.status, corsHeaders);
    } catch {
      return json({ ok: false, error: "SERVICE_UNAVAILABLE" }, 503, corsHeaders);
    }
  },
};
