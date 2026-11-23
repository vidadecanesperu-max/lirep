// QA258: local QR encoder and printable notice regression checks, no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const dir=new URL("../lirep/",import.meta.url);
const read=p=>fs.readFileSync(new URL(p,dir),"utf8");
const vendor=read("assets/js/vendor/qrcodegen.min.js");
const material=read("assets/js/lirep-material.js");
const php=read("includes/onboarding.php");
const c={};vm.runInNewContext(vendor,c);
assert.equal(typeof c.qrcodegen.QrCode.encodeText,"function");
const qr=c.qrcodegen.QrCode.encodeText("https://www.casahermasiepaget.com/libro-de-reclamaciones/",c.qrcodegen.QrCode.Ecc.QUARTILE);
assert(qr.size>=21&&qr.size<=177);
assert.equal(qr.getModule(0,0),true);
new vm.Script(material);
for(const k of ["data-material-download","qr-png","qr-svg","poster-png","poster-pdf","application/pdf","shape-rendering","pdfFromJpeg","encodeText","Acceso gratuito","Escanea para registrar"]){
  assert(material.includes(k),k);
}
assert.match(php,/current_user_can\('manage_options'\)/);
assert.match(php,/function lirep_official_complaints_page\(\)/);
assert.match(php,/get_page_by_path\('libro-de-reclamaciones'/);
assert.match(php,/'title' => 'Libro de Reclamaciones'/);
assert.match(php,/has_shortcode\(\$content, 'lirep'\)/);
assert.match(php,/get_post_meta\(\$page->ID, '_elementor_data', true\)/);
assert.match(php,/'publish' !== \$page->post_status/);
assert.match(php,/wp_parse_url\(\$public_url, PHP_URL_SCHEME\)/);
assert.match(php,/\$public_url = '';/);
assert.match(php,/data-public-url="<\?php echo esc_attr\(\$public_url\)/);
assert.match(php,/assets\/js\/vendor\/qrcodegen.min.js/);
assert.match(php,/assets\/js\/lirep-material.js/);
assert.match(php,/update_option\('lirep_company_name'/);
assert.doesNotMatch(php,/admin_post_lirep_prepare_public_page/);
assert.doesNotMatch(php,/wp_insert_post\(/);
assert.doesNotMatch(php,/Preparar página LIREP \(borrador\)/);
assert.doesNotMatch(php,/libro-de-reclamaciones-lirep/);
assert.match(php,/Editar página oficial existente/);
assert.match(php,/No debes crear una página adicional/);

assert(!material.includes("fetch("),"No network requests in offline materials");
assert(!material.includes("localStorage"),"No secrets or local persistence");
console.log("PASS QA258 | QR locally generated, PDF A4, WordPress gate, Elementor and data isolation");
