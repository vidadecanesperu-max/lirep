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
    ["vidadecanes.pe", "lirep-public-api.vidadecanes-peru.workers.dev"].includes(result.hostname)
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
      return new Response("<!doctype html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Libro de Reclamaciones | Vida de Canes ECO</title>\n<script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js\" async defer></script>\n<style>\n:root{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#172033;background:#f5f7fa}*{box-sizing:border-box}body{margin:0}.wrap{max-width:900px;margin:auto;padding:24px}.card{background:#fff;border:1px solid #dde3ea;border-radius:16px;padding:24px;box-shadow:0 8px 30px #1720330d}h1{margin:.2em 0;font-size:clamp(1.7rem,4vw,2.4rem)}h2{font-size:1.15rem;margin:28px 0 12px}.muted{color:#5f6b7a}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}label{display:block;font-weight:650;font-size:.92rem}input,select,textarea{width:100%;margin-top:6px;padding:12px;border:1px solid #cfd7e2;border-radius:10px;font:inherit;background:#fff}textarea{min-height:120px;resize:vertical}.full{grid-column:1/-1}[hidden]{display:none!important}.check{display:flex;gap:10px;align-items:flex-start;font-weight:400}.check input{width:auto;margin-top:4px}button{margin-top:18px;border:0;border-radius:10px;padding:13px 18px;font:inherit;font-weight:750;cursor:pointer;background:#172033;color:#fff}button:disabled{opacity:.55;cursor:not-allowed}.msg{margin-top:16px;padding:14px;border-radius:10px;display:none}.ok{display:block;background:#ecfdf3;color:#166534}.err{display:block;background:#fff1f2;color:#9f1239}.company{padding:12px 0 18px;border-bottom:1px solid #e5e9ef}.badge{display:inline-block;padding:5px 9px;border-radius:999px;background:#eef2f7;font-size:.8rem;font-weight:700}.footer{text-align:center;margin-top:18px;padding:14px 8px;color:#6b7280;font-size:.82rem}@media(max-width:650px){.wrap{padding:12px}.card{padding:18px}.grid{grid-template-columns:1fr}.full{grid-column:auto}}\n</style>\n</head>\n<body>\n<main class=\"wrap\"><section class=\"card\">\n<span class=\"badge\">Libro de Reclamaciones Virtual</span>\n<h1>Libro de Reclamaciones</h1>\n<div id=\"company\" class=\"company\"><strong>Vida de Canes ECO</strong><div class=\"muted\">Cargando información del establecimiento…</div></div>\n\n<form id=\"form\" novalidate>\n<h2>1. Identificación del consumidor</h2>\n<div class=\"grid\">\n<label>Tipo de documento<select name=\"document_type\" required><option value=\"dni\">DNI</option><option value=\"ce\">Carné de extranjería</option><option value=\"passport\">Pasaporte</option><option value=\"ruc\">RUC</option><option value=\"other\">Otro</option></select></label>\n<label>Número de documento<input name=\"document_number\" maxlength=\"50\" required></label>\n<label>Nombres<input name=\"first_names\" maxlength=\"150\" required></label>\n<label>Apellidos<input name=\"last_names\" maxlength=\"150\" required></label>\n<label>Teléfono<input name=\"phone\" type=\"tel\" maxlength=\"30\" required></label>\n<label>Correo electrónico<input name=\"email\" type=\"email\" maxlength=\"254\"></label>\n<label class=\"full\">Domicilio<input name=\"address\" maxlength=\"500\" required></label>\n<label class=\"full check\"><input type=\"checkbox\" id=\"is_minor\" name=\"is_minor\"><span>El consumidor es menor de edad</span></label>\n<div id=\"representative\" class=\"full grid\" hidden>\n<label>Nombres del padre, madre o representante<input name=\"representative_first_names\" maxlength=\"150\"></label>\n<label>Apellidos del padre, madre o representante<input name=\"representative_last_names\" maxlength=\"150\"></label>\n<label>Tipo de documento del representante<select name=\"representative_document_type\"><option value=\"dni\">DNI</option><option value=\"ce\">Carné de extranjería</option><option value=\"passport\">Pasaporte</option><option value=\"ruc\">RUC</option><option value=\"other\">Otro</option></select></label>\n<label>Número de documento del representante<input name=\"representative_document_number\" maxlength=\"50\"></label>\n<label>Teléfono del representante<input name=\"representative_phone\" type=\"tel\" maxlength=\"30\"></label>\n<label>Correo del representante<input name=\"representative_email\" type=\"email\" maxlength=\"254\"></label>\n</div>\n</div>\n\n<h2>2. Bien o servicio</h2>\n<div class=\"grid\">\n<label>Tipo<select name=\"product_service_type\" required><option value=\"servicio\">Servicio</option><option value=\"producto\">Producto</option></select></label>\n<label>Monto reclamado (S/)<input name=\"amount\" type=\"number\" min=\"0\" step=\"0.01\"></label>\n<label class=\"full\">Descripción<input name=\"product_service_description\" maxlength=\"1000\" required></label>\n</div>\n\n<h2>3. Detalle del reclamo o queja</h2>\n<div class=\"grid\">\n<label>Tipo<select name=\"complaint_type\" required><option value=\"reclamo\">Reclamo</option><option value=\"queja\">Queja</option></select></label>\n<label class=\"full\">Detalle<textarea name=\"detail\" maxlength=\"5000\" required></textarea></label>\n<label class=\"full\">Pedido del consumidor<textarea name=\"consumer_request\" maxlength=\"5000\" required></textarea></label>\n<label>Canal preferido de respuesta<select name=\"preferred_response_channel\" required><option value=\"email\">Correo electrónico</option><option value=\"phone\">Teléfono</option><option value=\"physical\">Domicilio</option></select></label>\n<label class=\"full check\"><input type=\"checkbox\" name=\"consumer_conformity\" required><span>Declaro que la información consignada es correcta y manifiesto mi conformidad con el registro electrónico de esta hoja en el Libro de Reclamaciones.</span></label>\n</div>\n\n<div class=\"cf-turnstile\" data-sitekey=\"0x4AAAAAAFQZXPjiJUTwSZmi\"></div>\n<button id=\"submit\" type=\"submit\">Registrar reclamo o queja</button>\n<div id=\"message\" class=\"msg\" role=\"status\" aria-live=\"polite\"></div>\n</form>\n</section><footer class=\"footer\">&copy; <span id=\"copyright-year\"></span> · Powered by 360 Integral Solutions</footer></main>\n<script>\ndocument.getElementById(\"copyright-year\").textContent=new Date().getFullYear();\nconst API=location.origin;\nconst PREFIX=\"VIDACANE\";\nlet establishmentCode=null,bookCode=null,idempotencyKey=null;\nconst company=document.getElementById(\"company\"),form=document.getElementById(\"form\"),message=document.getElementById(\"message\"),submit=document.getElementById(\"submit\");\n\nfunction uuid(){return crypto.randomUUID();}\nconst minor=document.getElementById(\"is_minor\"),representative=document.getElementById(\"representative\");\nfunction syncMinorFields(){\n representative.hidden=!minor.checked;\n representative.querySelectorAll(\"input,select\").forEach(el=>{\n  el.disabled=!minor.checked;\n  if([\"representative_first_names\",\"representative_last_names\",\"representative_document_type\",\"representative_document_number\"].includes(el.name))el.required=minor.checked;\n });\n}\nminor.addEventListener(\"change\",syncMinorFields);\nsyncMinorFields();\nfunction show(text,type){message.className=\"msg \"+type;message.textContent=text;}\nasync function loadConfig(){\n try{\n  const r=await fetch(API+\"/api/v1/form-config?public_prefix=\"+PREFIX);\n  const j=await r.json();\n  if(!r.ok||!j.ok)throw new Error();\n  const e=j.config.establishments?.[0],b=e?.books?.[0];\n  if(!e||!b)throw new Error();\n  establishmentCode=e.code;bookCode=b.code;\n  const org=j.config.organization;\n  const displayName=org.trade_name||org.legal_name;\n  const establishmentName=String(e.name||\"\").trim();\n  const normalizedDisplay=String(displayName||\"\").toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g,\" \").trim();\n  const normalizedEst=establishmentName.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g,\" \").trim();\n  const showEstablishment=establishmentName && normalizedEst!==normalizedDisplay && !normalizedEst.startsWith(normalizedDisplay+\" \");\n  company.innerHTML=\"<strong>\"+escapeHtml(displayName)+\"</strong><div class=\\\"muted\\\">\"+(showEstablishment?escapeHtml(establishmentName)+\" · \":\"\")+escapeHtml([e.district,e.province,e.department].filter(Boolean).join(\", \"))+\"</div>\";\n }catch{submit.disabled=true;show(\"El Libro de Reclamaciones no está disponible temporalmente. Intenta nuevamente más tarde.\",\"err\");}\n}\nfunction escapeHtml(v){const d=document.createElement(\"div\");d.textContent=String(v||\"\");return d.innerHTML;}\nform.addEventListener(\"submit\",async(e)=>{\n e.preventDefault();message.className=\"msg\";\n if(!form.reportValidity()||!establishmentCode||!bookCode)return;\n const fd=new FormData(form),token=fd.get(\"cf-turnstile-response\");\n if(!token){show(\"Completa la verificación de seguridad.\",\"err\");return;}\n submit.disabled=true;\n const body={\n  idempotency_key:(idempotencyKey||(idempotencyKey=uuid())),public_prefix:PREFIX,establishment_code:establishmentCode,book_code:bookCode,\n  document_type:fd.get(\"document_type\"),document_number:fd.get(\"document_number\"),first_names:fd.get(\"first_names\"),\n  last_names:fd.get(\"last_names\"),email:fd.get(\"email\"),phone:fd.get(\"phone\"),address:fd.get(\"address\"),is_minor:fd.get(\"is_minor\")===\"on\",\n  representative_first_names:fd.get(\"representative_first_names\")||null,representative_last_names:fd.get(\"representative_last_names\")||null,\n  representative_document_type:fd.get(\"representative_document_type\")||null,representative_document_number:fd.get(\"representative_document_number\")||null,\n  representative_phone:fd.get(\"representative_phone\")||null,representative_email:fd.get(\"representative_email\")||null,\n  consumer_conformity:fd.get(\"consumer_conformity\")===\"on\",preferred_response_channel:fd.get(\"preferred_response_channel\"),complaint_type:fd.get(\"complaint_type\"),\n  product_service_type:fd.get(\"product_service_type\"),product_service_description:fd.get(\"product_service_description\"),\n  amount:fd.get(\"amount\"),detail:fd.get(\"detail\"),consumer_request:fd.get(\"consumer_request\"),turnstile_token:token\n };\n try{\n  const r=await fetch(API+\"/api/v1/complaints\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify(body)});\n  const j=await r.json();\n  if(!r.ok||!j.ok)throw new Error(j.error||\"SUBMISSION_FAILED\");\n  const c=j.complaint;\n  show(\"Registro realizado correctamente. Código: \"+c.public_code+\". Conserva este código como constancia.\",\"ok\");\n  form.reset();syncMinorFields();idempotencyKey=null;if(window.turnstile)turnstile.reset();\n }catch(err){show(\"No se pudo registrar. \"+(err.message===\"TURNSTILE_FAILED\"?\"Repite la verificación de seguridad.\":\"Intenta nuevamente.\"),\"err\");if(window.turnstile)turnstile.reset();}\n finally{submit.disabled=false;}\n});\nloadConfig();\n</script>\n</body></html>", {
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
      return json({ ok: true, service: "lirep-public-api", version: "1.10.4" });
    }

    if (url.pathname === "/health/backend" && request.method === "GET") {
      const result = await supabaseConnectivity(env);
      return result.ok
        ? json({ ok: true, service: "lirep-public-api", version: "1.10.4", backend: "supabase", connected: true })
        : json({ ok: false, service: "lirep-public-api", version: "1.10.4", backend: "supabase", connected: false, error: result.error }, 503);
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

    if (
      !isUuid(idempotencyKey) ||
      !/^[A-Z0-9]{8}$/.test(normalizedPrefix) ||
      !documentTypes.has(input.document_type) ||
      !complaintTypes.has(input.complaint_type) ||
      (email !== null && !isEmail(email)) ||
      input.consumer_conformity !== true ||
      !["email","phone","physical"].includes(input.preferred_response_channel) ||
      (input.preferred_response_channel === "email" && email === null) ||
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
