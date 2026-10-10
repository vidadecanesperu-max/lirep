import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src/index.js",import.meta.url),"utf8");
for(const phrase of [
  'id=\\"receiptNotice\\"',
  'Este reclamo o queja ya estaba registrado.',
  'Por seguridad, la constancia no se vuelve a entregar en este reintento.',
  'la constancia descargable no está disponible en este momento.',
  'Puedes abrir y guardar tu constancia con el botón siguiente.',
  'Conserva este código de seguimiento:'
])assert.ok(source.includes(phrase),"Missing UX text: "+phrase);
assert.match(source,/receiptButton\.hidden=!lastReceiptToken/);
assert.match(source,/if \(!result\.data\.duplicate\)/);
console.log("QA-060 PASS - Mensajes de confirmación y protección del token");
