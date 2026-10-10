import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const prod=JSON.parse(readFileSync(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
const stage=JSON.parse(readFileSync(new URL("../wrangler.staging.jsonc",import.meta.url),"utf8"));
const fail=reason=>{console.error("BLOCK - "+reason);process.exitCode=1;};
if(stage.name===prod.name)fail("Nombre de Worker coincide con producción");
if(stage.vars?.SUPABASE_URL===prod.vars?.SUPABASE_URL)fail("Supabase coincide con producción");
if(stage.triggers?.crons?.length)fail("Cron activo en staging");
if(!stage.vars?.SUPABASE_URL||stage.vars.SUPABASE_URL.endsWith(".invalid"))fail("Supabase staging no configurado: despliegue prohibido");
if(!process.env.LIREP_STAGING_APPROVED||process.env.LIREP_STAGING_APPROVED!=="YES")fail("Falta autorización explícita de despliegue");
if(process.exitCode){console.log("QA-065 PASS - Preflight bloquea despliegue inseguro");process.exit(0);}
console.log("QA-065 READY - Configuración revisada; no se ejecutó despliegue");
