#!/usr/bin/env node
/**
 * LIREP public read-only smoke test. Node >=18, no packages, no credentials.
 * Never sends POST, never creates complaints, never changes Supabase or Cloudflare.
 * Usage: node scripts/qa-public-readonly.mjs [public_prefix] [worker_origin]
 */
const prefix = String(process.argv[2] || '9DC4C4F0').toUpperCase();
const origin = String(process.argv[3] || 'https://lirep-public-api.vidadecanes-peru.workers.dev').replace(/\/$/, '');
const failures = [];
function check(condition, description) {
  console.log((condition ? 'PASS' : 'FAIL') + ' | ' + description);
  if (!condition) failures.push(description);
}
if (!/^[A-Z0-9]{8}$/.test(prefix) || !/^https:\/\/[^/]+$/.test(origin)) {
  console.error('Invalid prefix or HTTPS worker origin');
  process.exit(2);
}
async function get(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(origin + path, { method: 'GET', headers: { 'accept': 'text/html,application/json' }, signal: controller.signal });
  } finally { clearTimeout(timer); }
}
try {
  const query = '?public_prefix=' + encodeURIComponent(prefix) + '&embed=1';
  const page = await get('/libro-de-reclamaciones' + query);
  const html = await page.text();
  check(page.status === 200, 'Public form HTTP 200');
  check(/<form\b/i.test(html), 'Form present');
  check(/turnstile/i.test(html), 'Turnstile markup present');
  check(!/Abrir el Libro de Reclamaciones en una ventana nueva/i.test(html), 'No redundant external link in Worker HTML');
  check(!/Vida de Canes ECO/i.test(html), 'No cross-tenant brand in Worker HTML');
  const config = await get('/api/v1/form-config?public_prefix=' + encodeURIComponent(prefix));
  const body = await config.json();
  check(config.status === 200 && body.ok === true, 'Company configuration available');
  check(Boolean(body.config?.organization), 'Tenant organization resolved');
  const invalid = await get('/api/v1/form-config?public_prefix=INVALID!');
  check(invalid.status === 400, 'Invalid prefix rejected');
  console.log('READ ONLY | No POST, no complaints created, no emails sent');
} catch (e) {
  failures.push('Network or response error');
  console.error('FAIL | ' + String(e.message || e));
}
process.exitCode = failures.length ? 1 : 0;
