import fs from 'node:fs';
const required=['README.md','VERSION','package.json','app/index.html','wordpress/lirep/lirep.php','supabase/migrations/README.md'];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error('Missing:',missing.join(', '));process.exit(1)}
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const version=fs.readFileSync('VERSION','utf8').trim();
if(pkg.version!==version){console.error('Version mismatch');process.exit(1)}
console.log(`LIREP baseline ${version} OK`);
