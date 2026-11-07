// LIREP 1.7.0 — Self-service onboarding API. Disabled until migration and QA are approved.
// WordPress communicates server-to-server; no browser CORS or Supabase secrets are exposed.
const BASE_PATH = "/api/v1/onboarding/";
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
const hexToken = (bytes = 32) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))),
    (b) => b.toString(16).padStart(2, "0")).join("");

function validDomain(domain) {
  if (typeof domain !== "string" || domain.length > 253) return false;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return false;
  if (/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(domain)) return false;
  if (domain.includes("..") || /^\d+(?:\.\d+){3}$/.test(domain)) return false;
  return true;
}

function validChallengeUrl(url, domain) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === domain &&
      u.port === "" && u.username === "" && u.password === "" &&
      u.search === "" && u.hash === "" &&
      /^\/(?:[a-z0-9_-]+\/)*wp-json\/lirep\/v1\/challenge$/i.test(u.pathname);
  } catch { return false; }
}

async function rpc(env, name, args) {
  const r = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(12000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = String(data?.message || "");
    if (msg.includes("LIREP_ONBOARDING_REVIEW_REQUIRED") || msg.includes("duplicate key")) {
      throw new Error("REVIEW_REQUIRED");
    }
    if (msg.includes("LIREP_ONBOARDING_INVALID_INPUT")) throw new Error("INVALID_INPUT");
    throw new Error("BACKEND_UNAVAILABLE");
  }
  return data;
}

async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !env.LIREP_APPROVED_FROM_EMAIL) throw new Error("EMAIL_NOT_CONFIGURED");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      from: "LIREP <" + env.LIREP_APPROVED_FROM_EMAIL + ">",
      to: [to], subject, html,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.id) throw new Error("EMAIL_DELIVERY_FAILED");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function authInvite(env, email) {
  const url = env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/admin/generate_link";
  const adminUrl = String(env.LIREP_ADMIN_URL || "");
  if (!/^https:\/\/[a-z0-9.-]+\/$/i.test(adminUrl)) throw new Error("AUTH_INVITE_UNAVAILABLE");
  async function generate(type) {
    const r = await fetch(url, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        "content-type": "application/json" },
      body: JSON.stringify({
        type, email, redirect_to: adminUrl,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => null);
    return { ok: r.ok, data: d, status: r.status };
  }
  let result = await generate("invite");
  if (!result.ok && (result.status === 422 || result.status === 400)) {
    // Existing Supabase Auth user: send a recovery link instead of claiming another identity.
    result = await generate("recovery");
  }
  const userId = result.data?.user?.id || result.data?.id;
  const actionLink = result.data?.properties?.action_link || result.data?.action_link;
  if (!result.ok || !/^[a-f0-9-]{36}$/i.test(String(userId)) ||
      typeof actionLink !== "string" ||
      !actionLink.startsWith(env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/verify?")) {
    throw new Error("AUTH_INVITE_UNAVAILABLE");
  }
  return { userId, actionLink };
}

function emailHtml(body) {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Activación LIREP</title></head><body style="font:16px system-ui,sans-serif;' +
    'background:#f5f7fa;color:#17243a;padding:36px"><main style="max-width:540px;' +
    'background:white;padding:32px;margin:auto;border-radius:12px">' + body +
    '</main></body></html>';
}

function verifyPage(success, confirmToken = null) {
  const body = confirmToken
    ? '<h1>Confirma tu correo</h1><p>Para completar la verificación, pulsa el botón.</p>' +
      '<form method="post" action="/api/v1/onboarding/verify-email">' +
      '<input type="hidden" name="token" value="' + escapeHtml(confirmToken) + '">' +
      '<button type="submit">Confirmar correo</button></form>'
    : success
      ? "<h1>Correo verificado</h1><p>Regresa a Ajustes → LIREP en tu WordPress y pulsa «Comprobar estado».</p>"
      : "<h1>Enlace no válido o caducado</h1><p>Solicita un nuevo enlace desde el asistente de LIREP.</p>";
  return new Response(emailHtml(body), {
    status: confirmToken || success ? 200 : 410,
    headers: { "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store", "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff" },
  });
}

async function status(env, id, statusToken) {
  if (!/^[a-f0-9-]{36}$/i.test(String(id)) || !/^[a-f0-9]{64}$/.test(String(statusToken))) {
    throw new Error("INVALID_TOKEN");
  }
  const result = await rpc(env, "lirep_onboarding_status", {
    p_id: id, p_status_hash: await sha256(statusToken),
  });
  if (!result) throw new Error("INVALID_TOKEN");
  return result;
}

async function deliverInvite(env, id, statusToken, state) {
  if (state.state === "active" && state.invitation_sent) return state;
  if (!state.email_verified || !state.domain_verified) throw new Error("NOT_VERIFIED");
  const { userId, actionLink } = await authInvite(env, state.contact_email);
  await rpc(env, "lirep_onboarding_provision", {
    p_id: id, p_status_hash: await sha256(statusToken), p_auth_user_id: userId,
  });
  await sendEmail(env, state.contact_email, "Acceso a la administración de LIREP",
    "<h2>Tu Libro de Reclamaciones está activado</h2>" +
    "<p>Para establecer tu acceso administrativo, abre este enlace de un solo uso:</p>" +
    '<p><a href="' + escapeHtml(actionLink) + '">Activar acceso LIREP</a></p>' +
    "<p>Si no solicitaste el servicio, ignora este correo.</p>");
  await rpc(env, "lirep_onboarding_mark_invited", {
    p_id: id, p_status_hash: await sha256(statusToken),
  });
  return await status(env, id, statusToken);
}

export async function handleOnboarding(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BASE_PATH)) return null;
  if (env.LIREP_SELF_ONBOARDING !== "true") return json({ ok: false, error: "ONBOARDING_NOT_ENABLED" }, 503);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.ONBOARD_RATE_LIMITER) {
    return json({ ok: false, error: "ONBOARDING_NOT_CONFIGURED" }, 503);
  }
  const route = url.pathname.slice(BASE_PATH.length);
  if (route === "verify-email" && request.method === "GET") {
    const token = url.searchParams.get("token") || "";
    return /^[a-f0-9]{64}$/.test(token) ? verifyPage(null, token) : verifyPage(false);
  }
  if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const limit = await env.ONBOARD_RATE_LIMITER.limit({ key: "onboarding:" + ip });
  if (!limit.success) return json({ ok: false, error: "RATE_LIMITED" }, 429);
  if (Number(request.headers.get("content-length") || 0) > 8192) {
    return json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
  }
  if (route === "verify-email") {
    const type = String(request.headers.get("content-type") || "");
    if (!type.startsWith("application/x-www-form-urlencoded")) return verifyPage(false);
    try {
      const form = await request.formData();
      const token = String(form.get("token") || "");
      if (!/^[a-f0-9]{64}$/.test(token)) return verifyPage(false);
      const valid = await rpc(env, "lirep_onboarding_verify_email", {
        p_email_hash: await sha256(token),
      });
      return verifyPage(valid === true);
    } catch { return verifyPage(false); }
  }
  let input;
  try { input = await request.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }
  try {
    if (route === "start") {
      const domain = String(input.domain || "").trim().toLowerCase();
      if (!validDomain(domain) || !validChallengeUrl(input.challenge_url, domain)) {
        throw new Error("INVALID_DOMAIN");
      }
      const emailToken = hexToken(), statusToken = hexToken(), challenge = hexToken();
      const payload = {
        domain, ruc: input.ruc, legal_name: input.legal_name,
        trade_name: input.trade_name, contact_email: input.contact_email,
        address: input.address, district: input.district, province: input.province,
        department: input.department, privacy_policy_url: input.privacy_policy_url,
      };
      const created = await rpc(env, "lirep_onboarding_start", {
        p_payload: payload, p_status_hash: await sha256(statusToken),
        p_email_hash: await sha256(emailToken), p_challenge_hash: await sha256(challenge),
      });
      return json({ ok: true, id: created.id, status_token: statusToken, challenge,
        expires_in_seconds: created.expires_in_seconds }, 201);
    }
    if (route === "cancel") {
      const state = await status(env, input.id, input.status_token);
      if (state.state !== "pending") throw new Error("NOT_VERIFIED");
      const canceled = await rpc(env, "lirep_onboarding_cancel", {
        p_id: input.id, p_status_hash: await sha256(input.status_token),
      });
      return json({ ok: canceled === true });
    }
    if (route === "status") {
      const state = await status(env, input.id, input.status_token);
      return json({ ok: true, state });
    }
    if (route === "verify-domain") {
      const state = await status(env, input.id, input.status_token);
      if (state.state === "expired") throw new Error("EXPIRED");
      if (state.state === "pending" && !state.domain_verified) {
        if (!validDomain(state.domain) || !validChallengeUrl(input.challenge_url, state.domain)) {
          throw new Error("INVALID_DOMAIN");
        }
        const proof = await fetch(input.challenge_url, {
          method: "GET", redirect: "manual",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(9000),
        });
        if (proof.status !== 200 || !String(proof.headers.get("content-type") || "").includes("application/json")) {
          throw new Error("DOMAIN_CHALLENGE_FAILED");
        }
        const body = await proof.text();
        if (body.length > 2048) throw new Error("DOMAIN_CHALLENGE_FAILED");
        const challenge = JSON.parse(body)?.challenge;
        if (!/^[a-f0-9]{64}$/.test(String(challenge))) throw new Error("DOMAIN_CHALLENGE_FAILED");
        const valid = await rpc(env, "lirep_onboarding_verify_domain", {
          p_id: input.id, p_status_hash: await sha256(input.status_token),
          p_challenge_hash: await sha256(challenge),
        });
        if (!valid) throw new Error("DOMAIN_CHALLENGE_FAILED");
      }
      const fresh = await status(env, input.id, input.status_token);
      if (!fresh.email_verified) {
        const emailToken = hexToken();
        const rotated = await rpc(env, "lirep_onboarding_set_email_token", {
          p_id: input.id, p_status_hash: await sha256(input.status_token),
          p_email_hash: await sha256(emailToken),
        });
        if (!rotated) throw new Error("EMAIL_RATE_LIMITED");
        const verifyUrl = url.origin + BASE_PATH + "verify-email?token=" + emailToken;
        await sendEmail(env, fresh.contact_email, "Verifica tu correo para activar LIREP",
          "<h2>Confirma tu correo para activar LIREP</h2><p>Dominio verificado: " +
          escapeHtml(fresh.domain) + '</p><p><a href="' + escapeHtml(verifyUrl) +
          '">Verificar correo</a></p><p>El enlace caduca en 24 horas.</p>');
        return json({ ok: true, state: fresh, notice: "EMAIL_SENT" });
      }
      const activated = await deliverInvite(env, input.id, input.status_token, fresh);
      return json({ ok: true, state: activated });
    }
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  } catch (e) {
    const reason = String(e?.message || "SERVICE_UNAVAILABLE");
    const publicErrors = ["INVALID_DOMAIN","INVALID_INPUT","REVIEW_REQUIRED","INVALID_TOKEN",
      "EMAIL_NOT_VERIFIED","EMAIL_RATE_LIMITED","EXPIRED","DOMAIN_CHALLENGE_FAILED","NOT_VERIFIED"];
    const safe = publicErrors.includes(reason) ? reason : "SERVICE_UNAVAILABLE";
    const code = safe === "REVIEW_REQUIRED" ? 409 :
      safe === "INVALID_TOKEN" ? 403 : safe === "EMAIL_RATE_LIMITED" ? 429 : safe === "EMAIL_NOT_VERIFIED" ? 409 :
      safe === "EXPIRED" ? 410 : safe === "SERVICE_UNAVAILABLE" ? 503 : 400;
    return json({ ok: false, error: safe }, code);
  }
}
