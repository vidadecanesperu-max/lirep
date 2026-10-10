import {readFileSync} from "node:fs";
const load=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),"utf8"));
const prod=load("../wrangler.jsonc");
const stage=load("../wrangler.staging.jsonc");
const errors=[];
if(stage.name===prod.name)errors.push("Worker coincide con producción");
if(stage.vars?.SUPABASE_URL===prod.vars?.SUPABASE_URL)errors.push("Supabase coincide con producción");
if(!stage.vars?.SUPABASE_URL||stage.vars.SUPABASE_URL.endsWith(".invalid"))errors.push("Supabase staging no configurado");
if(stage.triggers?.crons?.length)errors.push("Cron de staging habilitado");
if(stage.ratelimits?.[0]?.namespace_id===prod.ratelimits?.[0]?.namespace_id)errors.push("Rate limit compartido");
if(process.env.LIREP_STAGING_APPROVED!=="YES")errors.push("Autorización explícita ausente");
if(errors.length){for(const e of errors)console.error("BLOCK - "+e);process.exit(2);}
console.log("PREFLIGHT READY - Apto para evaluación manual; no se ejecutó despliegue");
