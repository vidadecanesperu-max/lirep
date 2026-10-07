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

  if (!origin || !allowed.includes(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
    return false;
  }

  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
  });

  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(10000),
    },
  );

  if (!response.ok) return false;
  const result = await response.json();
  return (
    result.success === true &&
    result.hostname === "vidadecanes.pe"
  );
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if ((url.pathname === "/" || url.pathname === "/libro-de-reclamaciones") && request.method === "GET") {
      return new Response(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Libro de Reclamaciones | Vida de Canes ECO</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
:root{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#172033;background:#f5f7fa}*{box-sizing:border-box}body{margin:0}.wrap{max-width:900px;margin:auto;padding:24px}.card{background:#fff;border:1px solid #dde3ea;border-radius:16px;padding:24px;box-shadow:0 8px 30px #1720330d}h1{margin:.2em 0;font-size:clamp(1.7rem,4vw,2.4rem)}h2{font-size:1.15rem;margin:28px 0 12px}.muted{color:#5f6b7a}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}label{display:block;font-weight:650;font-size:.92rem}input,select,textarea{width:100%;margin-top:6px;padding:12px;border:1px solid #cfd7e2;border-radius:10px;font:inherit;background:#fff}textarea{min-height:120px;resize:vertical}.full{grid-column:1/-1}.check{display:flex;gap:10px;align-items:flex-start;font-weight:400}.check input{width:auto;margin-top:4px}button{margin-top:18px;border:0;border-radius:10px;padding:13px 18px;font:inherit;font-weight:750;cursor:pointer;background:#172033;color:#fff}button:disabled{opacity:.55;cursor:not-allowed}.msg{margin-top:16px;padding:14px;border-radius:10px;display:none}.ok{display:block;background:#ecfdf3;color:#166534}.err{display:block;background:#fff1f2;color:#9f1239}.company{padding:12px 0 18px;border-bottom:1px solid #e5e9ef}.badge{display:inline-block;padding:5px 9px;border-radius:999px;background:#eef2f7;font-size:.8rem;font-weight:700}.footer{text-align:center;margin-top:18px;padding:14px 8px;color:#6b7280;font-size:.82rem}@media(max-width:650px){.wrap{padding:12px}.card{padding:18px}.grid{grid-template-columns:1fr}.full{grid-column:auto}}
</style>
</head>
<body>
<main class="wrap"><section class="card">
<span class="badge">Libro de Reclamaciones Virtual</span>
<h1>Libro de Reclamaciones</h1>
<div id="company" class="company"><strong>Vida de Canes ECO</strong><div class="muted">Cargando información del establecimiento…</div></div>

<form id="form" novalidate>
<h2>1. Identificación del consumidor</h2>
<div class="grid">
<label>Tipo de documento<select name="document_type" required><option value="dni">DNI</option><option value="ce">Carné de extranjería</option><option value="passport">Pasaporte</option><option value="ruc">RUC</option><option value="other">Otro</option></select></label>
<label>Número de documento<input name="document_number" maxlength="50" required></label>
<label>Nombres<input name="first_names" maxlength="150" required></label>
<label>Apellidos<input name="last_names" maxlength="150" required></label>
<label class="full">Correo electrónico<input name="email" type="email" maxlength="254" required></label>
</div>

<h2>2. Bien o servicio</h2>
<div class="grid">
<label>Tipo<select name="product_service_type" required><option value="servicio">Servicio</option><option value="producto">Producto</option></select></label>
<label>Monto reclamado (S/)<input name="amount" type="number" min="0" step="0.01"></label>
<label class="full">Descripción<input name="product_service_description" maxlength="1000" required></label>
</div>

<h2>3. Detalle del reclamo o queja</h2>
<div class="grid">
<label>Tipo<select name="complaint_type" required><option value="reclamo">Reclamo</option><option value="queja">Queja</option></select></label>
<label class="full">Detalle<textarea name="detail" maxlength="5000" required></textarea></label>
<label class="full">Pedido del consumidor<textarea name="consumer_request" maxlength="5000" required></textarea></label>
<label class="full check"><input type="checkbox" name="confirm" required><span>Declaro que la información consignada es correcta y solicito el registro de esta hoja en el Libro de Reclamaciones.</span></label>
</div>

<div class="cf-turnstile" data-sitekey="0x4AAAAAAFQZXPjiJUTwSZmi"></div>
<button id="submit" type="submit">Registrar reclamo o queja</button>
<div id="message" class="msg" role="status" aria-live="polite"></div>
</form>
</section><footer class="footer">&copy; <span id="copyright-year"></span> · Powered by 360 Integral Solutions</footer></main>
<script>
document.getElementById("copyright-year").textContent=new Date().getFullYear();
const API="https://lirep-public-api.vidadecanes-peru.workers.dev";
const PREFIX="VIDACANE";
let establishmentCode=null,bookCode=null;
const company=document.getElementById("company"),form=document.getElementById("form"),message=document.getElementById("message"),submit=document.getElementById("submit");

function uuid(){return crypto.randomUUID();}
function show(text,type){message.className="msg "+type;message.textContent=text;}
async function loadConfig(){
 try{
  const r=await fetch(API+"/api/v1/form-config?public_prefix="+PREFIX);
  const j=await r.json();
  if(!r.ok||!j.ok)throw new Error();
  const e=j.config.establishments?.[0],b=e?.books?.[0];
  if(!e||!b)throw new Error();
  establishmentCode=e.code;bookCode=b.code;
  const org=j.config.organization;
  company.innerHTML="<strong>"+escapeHtml(org.trade_name||org.legal_name)+"</strong><div class=\"muted\">"+escapeHtml(e.name)+" · "+escapeHtml([e.district,e.province,e.department].filter(Boolean).join(", "))+"</div>";
 }catch{submit.disabled=true;show("El Libro de Reclamaciones no está disponible temporalmente. Intenta nuevamente más tarde.","err");}
}
function escapeHtml(v){const d=document.createElement("div");d.textContent=String(v||"");return d.innerHTML;}
form.addEventListener("submit",async(e)=>{
 e.preventDefault();message.className="msg";
 if(!form.reportValidity()||!establishmentCode||!bookCode)return;
 const fd=new FormData(form),token=fd.get("cf-turnstile-response");
 if(!token){show("Completa la verificación de seguridad.","err");return;}
 submit.disabled=true;
 const body={
  idempotency_key:uuid(),public_prefix:PREFIX,establishment_code:establishmentCode,book_code:bookCode,
  document_type:fd.get("document_type"),document_number:fd.get("document_number"),first_names:fd.get("first_names"),
  last_names:fd.get("last_names"),email:fd.get("email"),complaint_type:fd.get("complaint_type"),
  product_service_type:fd.get("product_service_type"),product_service_description:fd.get("product_service_description"),
  amount:fd.get("amount"),detail:fd.get("detail"),consumer_request:fd.get("consumer_request"),turnstile_token:token
 };
 try{
  const r=await fetch(API+"/api/v1/complaints",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json();
  if(!r.ok||!j.ok)throw new Error(j.error||"SUBMISSION_FAILED");
  const c=j.complaint;
  show("Registro realizado correctamente. Código: "+c.public_code+". Conserva este código como constancia.","ok");
  form.reset();if(window.turnstile)turnstile.reset();
 }catch(err){show("No se pudo registrar. "+(err.message==="TURNSTILE_FAILED"?"Repite la verificación de seguridad.":"Intenta nuevamente."),"err");if(window.turnstile)turnstile.reset();}
 finally{submit.disabled=false;}
});
loadConfig();
</script>
</body></html>`, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "lirep-public-api", version: "1.9.2" });
    }

    if (url.pathname === "/health/backend" && request.method === "GET") {
      const result = await supabaseConnectivity(env);
      return result.ok
        ? json({ ok: true, service: "lirep-public-api", version: "1.9.2", backend: "supabase", connected: true })
        : json({ ok: false, service: "lirep-public-api", version: "1.9.2", backend: "supabase", connected: false, error: result.error }, 503);
    }

    if (url.pathname === "/api/v1/form-config" && request.method === "GET") {
      const requestOrigin = request.headers.get("Origin");
      const corsHeaders = requestOrigin ? cors(request, env) : {};
      if (requestOrigin && !corsHeaders) {
        return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
      }

      const publicPrefix = String(url.searchParams.get("public_prefix") || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(publicPrefix)) {
        return json({ ok: false, error: "INVALID_PUBLIC_PREFIX" }, 400, corsHeaders);
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

    const corsHeaders = cors(request, env);

    if (request.method === "OPTIONS") {
      if (!corsHeaders) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, corsHeaders || {});
    }

    if (!corsHeaders) {
      return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
    }

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

    if (
      !isUuid(idempotencyKey) ||
      !/^[A-Z0-9]{8}$/.test(normalizedPrefix) ||
      !documentTypes.has(input.document_type) ||
      !complaintTypes.has(input.complaint_type) ||
      (email !== null && !isEmail(email))
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

      return json({ ok: true, complaint: result.data }, result.status, corsHeaders);
    } catch {
      return json({ ok: false, error: "SERVICE_UNAVAILABLE" }, 503, corsHeaders);
    }
  },
};
