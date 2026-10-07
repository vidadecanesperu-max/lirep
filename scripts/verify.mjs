import fs from 'node:fs';

const required=[
  'README.md','VERSION','package.json','app/index.html',
  'worker/src/index.js','wordpress/lirep/lirep.php','supabase/migrations/README.md'
];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error('Missing:',missing.join(', '));process.exit(1)}

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const version=fs.readFileSync('VERSION','utf8').trim();
if(pkg.version!==version){console.error('Version mismatch');process.exit(1)}

const worker=fs.readFileSync('worker/src/index.js','utf8');
const app=fs.readFileSync('app/index.html','utf8');
const plugin=fs.readFileSync('wordpress/lirep/lirep.php','utf8');

const forbidden=[
  ['worker hardcoded tenant', worker, 'const PREFIX=\\\"VIDACANE\\\"'],
  ['app hardcoded tenant', app, 'const PREFIX="VIDACANE"']
];
for(const [name,body,needle] of forbidden){
  if(body.includes(needle)){console.error('SECURITY FAIL:',name);process.exit(1)}
}
for(const [name,body,needle] of [
  ['worker fail closed',worker,'PUBLIC_PREFIX_REQUIRED'],
  ['app fail closed',app,'PUBLIC_PREFIX_REQUIRED'],
  ['worker tenant header',worker,'X-LIREP-Prefix'],
  ['plugin tenant setting',plugin,'lirep_public_prefix']
]){
  if(!body.includes(needle)){console.error('SECURITY FAIL:',name);process.exit(1)}
}
console.log(`LIREP ${version} verification OK`);
console.log('Tenant isolation guards OK');
