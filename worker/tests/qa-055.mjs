import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const sourcePath = new URL("../src/index.js", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
execFileSync(process.execPath, ["--check", sourcePath.pathname], { stdio: "pipe" });
assert.match(source, /if \(!result\.data\.duplicate\)\s*\{\s*receiptToken\s*=\s*await lirepRpc\("lirep_issue_receipt_token"/);
assert.match(source, /if \(prefix !== "LIREPQA1"\) return;/);
const worker = (await import(pathToFileURL(sourcePath.pathname).href)).default;
assert.equal(typeof worker.fetch, "function");
assert.equal(typeof worker.scheduled, "function");
let calls = 0;
await worker.scheduled({}, { RESEND_API_KEY: "test" }, { waitUntil(p) { calls++; return p; } });
assert.equal(calls, 0, "Scheduled email must not claim queue jobs");
console.log("QA-055 PASS: syntax, duplicate guard, immediate email QA gate, cron disabled");
