import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const handlers = new Map();
const frameHandlers = new Map();
const attributes = new Map([
  ['data-lirep-origin', 'https://lirep-public-api.vidadecanes-peru.workers.dev'],
  ['data-lirep-prefix', 'VIDACANE'],
]);
const posted = [];
const frameWindow = { postMessage: (...args) => posted.push(args) };
const frame = { contentWindow: frameWindow, style: {}, addEventListener: (name, fn) => frameHandlers.set(name, fn) };
const container = {
  getAttribute: (key) => attributes.get(key),
  setAttribute: (key, value) => attributes.set(key, value),
  querySelector: () => frame,
};
const document = {
  readyState: 'complete',
  hidden: false,
  body: {},
  querySelectorAll: () => [container],
  addEventListener: (name, fn) => handlers.set('document:' + name, fn),
};
const window = { addEventListener: (name, fn) => handlers.set(name, fn) };
const context = {
  window, document, WeakSet, Number, Math,
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout: () => {},
};
vm.runInNewContext(fs.readFileSync(new URL('../lirep/assets/js/lirep-embed.js', import.meta.url), 'utf8'), context);
const onMessage = handlers.get('message');
assert.equal(typeof onMessage, 'function');
assert.equal(attributes.get('data-lirep-initialized'), '1');
assert.ok(posted.length > 0);
assert.equal(posted[0][1], 'https://lirep-public-api.vidadecanes-peru.workers.dev');
assert.equal(frame.style.height, undefined);
function message(origin, source, prefix, height) {
  onMessage({ origin, source, data: { type: 'lirep:resize', prefix, height } });
}
message('https://evil.test', frameWindow, 'VIDACANE', 600);
assert.equal(frame.style.height, undefined, 'Foreign origin blocked');
message('https://lirep-public-api.vidadecanes-peru.workers.dev', {}, 'VIDACANE', 600);
assert.equal(frame.style.height, undefined, 'Foreign window blocked');
message('https://lirep-public-api.vidadecanes-peru.workers.dev', frameWindow, 'EVIL0000', 600);
assert.equal(frame.style.height, undefined, 'Foreign tenant blocked');
message('https://lirep-public-api.vidadecanes-peru.workers.dev', frameWindow, 'VIDACANE', 20000);
assert.equal(frame.style.height, undefined, 'Oversized height blocked');
message('https://lirep-public-api.vidadecanes-peru.workers.dev', frameWindow, 'VIDACANE', 612);
assert.equal(frame.style.height, '624px', 'Correct height accepted');
assert.equal(typeof frameHandlers.get('load'), 'function');
frameHandlers.get('load')();
assert.ok(posted.length > 1, 'Resize handshake after iframe load');
console.log('LIREP embed JS QA: 8/8 PASS');
