import assert from "node:assert/strict";
import worker from "../src/index.js";

const origin = "https://lirep-qa.example";
const env = {
  SUPABASE_URL: "https://supabase.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "offline-test",
  TURNSTILE_SECRET: "offline-test",
  ALLOWED_ORIGINS: origin,
  SUBMIT_RATE_LIMITER: { async limit() { return { success: true }; } },
};
const payload = {
  idempotency_key: "afdaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  public_prefix: "LIREPQA1",
  establishment_code: "QA001",
  book_code: "QA001",
  document_type: "dni",
  document_number: "12345678",
  first_names: "Prueba",
  last_names: "Local",
  email: "prueba@example.invalid",
  phone: "999999999",
  address: "Dirección de prueba",
  is_minor: false,
  complaint_type: "reclamo",
  product_service_type: "servicio",
  product_service_description: "Servicio de prueba",
  amount: "1",
  detail: "Prueba local sin registro real",
  consumer_request: "Validar respuesta",
  consumer_conformity: true,
  preferred_response_channel: "email",
  turnstile_token: "offline",
};
const originalFetch = globalThis.fetch;
const calls = [];
const row = {
  public_code: "LIREPQA1-QA001-2026-00000099",
  sequence_number: 99,
  submitted_at: "2026-10-10T12:00:00Z",
  response_due_at: "2026-11-02T23:59:59Z",
};
let duplicate = false;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push(url);
  if (url.includes("siteverify")) return Response.json({ success: true, hostname: "lirep-public-api.vidadecanes-peru.workers.dev" });
  if (url.includes("lirep_public_origin_allowed")) return Response.json(true);
  if (url.includes("lirep_submit_public_complaint_gateway")) return Response.json([{ ...row, duplicate }]);
  if (url.includes("lirep_issue_receipt_token")) return Response.json("12345678-1234-4234-8234-123456789abc");
  throw new Error("Unexpected external call: " + url);
};
const ctx = { waitUntil(p) { return p; } };
const request = () => new Request(origin + "/api/v1/complaints?public_prefix=LIREPQA1", {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json", "X-LIREP-Prefix": "LIREPQA1" },
  body: JSON.stringify(payload),
});
try {
  let response = await worker.fetch(request(), env, ctx);
  let body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.complaint.duplicate, false);
  assert.equal(body.complaint.receipt_token, "12345678-1234-4234-8234-123456789abc");
  assert.equal(calls.filter(x => x.includes("lirep_issue_receipt_token")).length, 1);
  console.log("PASS - Registro nuevo: token entregado");

  duplicate = true;
  calls.length = 0;
  response = await worker.fetch(request(), env, ctx);
  body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.complaint.duplicate, true);
  assert.equal(body.complaint.receipt_token, null);
  assert.equal(calls.filter(x => x.includes("lirep_issue_receipt_token")).length, 0);
  console.log("PASS - Reintento duplicado: token protegido");

  calls.length = 0;
  await worker.scheduled({}, { ...env, RESEND_API_KEY: "offline" }, ctx);
  assert.equal(calls.length, 0);
  console.log("PASS - Cron: sin solicitudes externas");
  console.log("QA-056 PASS - Simulación local; sin escrituras ni envíos");
} finally {
  globalThis.fetch = originalFetch;
}
