import assert from "node:assert/strict";
import { handleOnboarding } from "../src/onboarding.js";

const base = "https://lirep-public-api.vidadecanes-peru.workers.dev";
const sb = "https://staging.supabase.co";
const env = {
  LIREP_SELF_ONBOARDING: "true",
  SUPABASE_URL: sb,
  SUPABASE_SERVICE_ROLE_KEY: "qa-secret-never-exposed",
  RESEND_API_KEY: "qa-email-key",
  LIREP_APPROVED_FROM_EMAIL: "lirep@mail.vidadecanes.pe",
  ONBOARD_RATE_LIMITER: { limit: async () => ({ success: true }) },
};
let pass = 0;
async function qa(name, fn) { await fn(); pass++; console.log("PASS | " + name); }
const req = (route, data, method = "POST") => new Request(base + "/api/v1/onboarding/" + route, {
  method, headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.5" },
  ...(method === "POST" ? { body: JSON.stringify(data) } : {}),
});
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
let statusValue = { state: "pending", email_verified: false, domain_verified: false,
  invitation_sent: false, contact_email: "qa@example.com", domain: "demo.example.com" };
let challenge = "";
let mailCount = 0;
let rpcCount = 0;
let domainFetched = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.includes("/rest/v1/rpc/")) {
    rpcCount++;
    const name = url.split("/").at(-1);
    if (name === "lirep_onboarding_start") return reply({
      id: "00000000-0000-4000-8000-000000000001", expires_in_seconds: 86400,
    });
    if (name === "lirep_onboarding_status") return reply(statusValue);
    if (name === "lirep_onboarding_verify_email") return reply(true);
    if (name === "lirep_onboarding_set_email_token") return reply(true);
    if (name === "lirep_onboarding_verify_domain") {
      statusValue = { ...statusValue, domain_verified: true };
      return reply(true);
    }
    if (name === "lirep_onboarding_provision") {
      statusValue = { ...statusValue, state: "active", public_prefix: "ABC12345" };
      return reply({ public_prefix: "ABC12345", already_active: false });
    }
    if (name === "lirep_onboarding_mark_invited") {
      statusValue = { ...statusValue, invitation_sent: true };
      return reply(true);
    }
    if (name === "lirep_onboarding_cancel") return reply(true);
    throw Error("Unexpected RPC " + name);
  }
  if (url === "https://api.resend.com/emails") {
    mailCount++;
    assert.ok(options.headers.authorization.startsWith("Bearer "));
    return reply({ id: "qa-mail-" + mailCount });
  }
  if (url === sb + "/auth/v1/admin/generate_link") {
    return reply({ user: { id: "00000000-0000-4000-8000-000000000002" },
      properties: { action_link: sb + "/auth/v1/verify?token=qa&type=invite" } });
  }
  if (url === "https://demo.example.com/wp-json/lirep/v1/challenge") {
    domainFetched++;
    assert.equal(options.redirect, "manual");
    return reply({ challenge });
  }
  throw Error("Unexpected outbound fetch " + url);
};

await qa("Flag disabled by default blocks all onboarding", async () => {
  const r = await handleOnboarding(req("start", {}), { ...env, LIREP_SELF_ONBOARDING: "false" });
  assert.equal(r.status, 503);
});
await qa("Missing rate limiter fails closed", async () => {
  const r = await handleOnboarding(req("start", {}), { ...env, ONBOARD_RATE_LIMITER: undefined });
  assert.equal(r.status, 503);
});
await qa("Non-onboarding paths ignored", async () => {
  const r = await handleOnboarding(new Request(base + "/health"), env);
  assert.equal(r, null);
});
await qa("Invalid method blocked", async () => {
  const r = await handleOnboarding(new Request(base + "/api/v1/onboarding/start"), env);
  assert.equal(r.status, 405);
});
await qa("Invalid domain blocked before database", async () => {
  const n = rpcCount;
  const r = await handleOnboarding(req("start", {
    domain: "127.0.0.1", challenge_url: "https://127.0.0.1/wp-json/lirep/v1/challenge",
  }), env);
  assert.equal(r.status, 400);
  assert.equal(rpcCount, n);
});
let session;
await qa("Registration generates secrets without sending email before proof", async () => {
  const r = await handleOnboarding(req("start", {
    domain: "demo.example.com",
    challenge_url: "https://demo.example.com/wp-json/lirep/v1/challenge",
    ruc: "20123456786", legal_name: "QA Empresa", trade_name: "QA",
    contact_email: "qa@example.com", address: "Calle QA 123",
    district: "Lima", province: "Lima", department: "Lima",
    privacy_policy_url: "https://demo.example.com/privacidad",
  }), env);
  assert.equal(r.status, 201);
  session = await r.json();
  assert.equal(session.ok, true);
  assert.match(session.challenge, /^[a-f0-9]{64}$/);
  assert.match(session.status_token, /^[a-f0-9]{64}$/);
  assert.notEqual(session.challenge, session.status_token);
  assert.equal(mailCount, 0, "No email before domain proof");
  challenge = session.challenge;
});
await qa("Status uses secret token and returns no service key", async () => {
  const r = await handleOnboarding(req("status", { id: session.id, status_token: session.status_token }), env);
  assert.equal(r.status, 200);
  assert.doesNotMatch(await r.text(), /qa-secret-never-exposed/);
});
await qa("Domain challenge cannot be redirected to unrelated host", async () => {
  const n = domainFetched;
  const r = await handleOnboarding(req("verify-domain", {
    id: session.id, status_token: session.status_token,
    challenge_url: "https://attacker.example.com/wp-json/lirep/v1/challenge",
  }), env);
  assert.equal(r.status, 400);
  assert.equal(domainFetched, n);
});
await qa("Verified domain sends email, without provisioning yet", async () => {
  const r = await handleOnboarding(req("verify-domain", {
    id: session.id, status_token: session.status_token,
    challenge_url: "https://demo.example.com/wp-json/lirep/v1/challenge",
  }), env);
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.equal(result.notice, "EMAIL_SENT");
  assert.equal(result.state.state, "pending");
  assert.equal(domainFetched, 1);
  assert.equal(mailCount, 1);
});
await qa("Email link verifies after domain challenge", async () => {
  const r = await handleOnboarding(new Request(base + "/api/v1/onboarding/verify-email?token=" + "f".repeat(64)), env);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Correo verificado/);
  statusValue = { ...statusValue, email_verified: true };
});
await qa("Verified email provisions tenant and sends Auth invitation", async () => {
  const r = await handleOnboarding(req("verify-domain", {
    id: session.id, status_token: session.status_token,
    challenge_url: "https://demo.example.com/wp-json/lirep/v1/challenge",
  }), env);
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.equal(result.state.public_prefix, "ABC12345");
  assert.equal(result.state.invitation_sent, true);
  assert.equal(domainFetched, 1, "Domain not fetched again after proof");
  assert.equal(mailCount, 2);
});
await qa("Cancel only accepts a pending authenticated session", async () => {
  statusValue = { ...statusValue, state: "pending" };
  const r = await handleOnboarding(req("cancel", { id: session.id, status_token: session.status_token }), env);
  assert.equal(r.status, 200);
});
await qa("Bad status token rejected", async () => {
  const r = await handleOnboarding(req("status", { id: session.id, status_token: "bad" }), env);
  assert.equal(r.status, 403);
});
console.log("LIREP onboarding Worker QA: " + pass + "/" + pass + " PASS");
