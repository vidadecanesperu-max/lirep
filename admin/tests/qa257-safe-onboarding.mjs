// QA257: safe user-initiated redemption, without production calls.
import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]?.trimStart().replace(/^import[^\n]+\n/,"");
assert.ok(script);
new vm.Script(script);
assert.match(html,/id="firstAccessConfirm" hidden/);
assert.match(html,/id="firstAccessButton"/);
assert.match(html,/id="firstAccessNotice"/);
assert.match(script,/initialHash\.get\('lirep_login_token'\)/);
assert.match(script,/history\.replaceState\(null,'',location\.pathname\+location\.search\)/);
assert.match(script,/\$\('firstAccessButton'\)\.addEventListener\('click',async\(\)=>/);
assert.match(script,/db\.auth\.verifyOtp\(\{token_hash:token,type:'magiclink'\}\)/);
assert.match(script,/firstAccessHash='';/);
assert.match(script,/await initialize\(\)/);
assert.match(script,/lirep_admin_my_organizations/);
console.log("QA257 ADMIN PASS | access confirmation requires click, tenancy intact");
