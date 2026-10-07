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
  return result.success === true;
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

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "lirep-public-api", version: "1.8.0" });
    }

    if (url.pathname === "/health/backend" && request.method === "GET") {
      const result = await supabaseConnectivity(env);
      return result.ok
        ? json({ ok: true, service: "lirep-public-api", version: "1.8.0", backend: "supabase", connected: true })
        : json({ ok: false, service: "lirep-public-api", version: "1.8.0", backend: "supabase", connected: false, error: result.error }, 503);
    }

    if (url.pathname === "/api/v1/form-config" && request.method === "GET") {
      const corsHeaders = cors(request, env);
      if (!corsHeaders) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);

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

    const payload = {
      p_idempotency_key: idempotencyKey,
      p_public_prefix: publicPrefix,
      p_establishment_code: establishmentCode,
      p_book_code: bookCode,
      p_document_type: input.document_type,
      p_document_number: documentNumber,
      p_first_names: firstNames,
      p_last_names: lastNames,
      p_email:
        typeof input.email === "string" && input.email.trim()
          ? input.email.trim().slice(0, 254)
          : null,
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
