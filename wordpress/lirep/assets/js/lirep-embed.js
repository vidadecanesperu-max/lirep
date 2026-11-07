/* LIREP 1.6.0: origin-checked, tenant-checked iframe resizing for WordPress/Elementor. */
(function () {
  'use strict';
  var selector = '[data-lirep-embed="1"]';
  var known = typeof WeakSet === 'function' ? new WeakSet() : null;

  function initialize(container) {
    if (known && known.has(container)) return;
    if (container.getAttribute('data-lirep-initialized') === '1') return;
    var frame = container.querySelector('iframe.lirep-frame');
    var origin = container.getAttribute('data-lirep-origin');
    var prefix = container.getAttribute('data-lirep-prefix');
    if (!frame || !/^https:\/\/[a-z0-9.-]+$/i.test(origin || '') || !/^[A-Z0-9]{8}$/.test(prefix || '')) return;
    if (known) known.add(container);
    container.setAttribute('data-lirep-initialized', '1');
    var lastHeight = 0;
    var timer = null;
    var accepted = false;

    function requestHeight() {
      try {
        if (frame.contentWindow) frame.contentWindow.postMessage({ type: 'lirep:measure' }, origin);
      } catch (_) { /* Cross-origin frames are expected. */ }
    }
    function handleMessage(event) {
      if (event.origin !== origin || event.source !== frame.contentWindow) return;
      var data = event.data;
      if (!data || data.type !== 'lirep:resize' || data.prefix !== prefix) return;
      var height = Number(data.height);
      if (!Number.isFinite(height) || height < 300 || height > 15000) return;
      var next = Math.ceil(height + 12);
      if (Math.abs(next - lastHeight) < 3) return;
      accepted = true;
      lastHeight = next;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { frame.style.height = next + 'px'; }, 30);
    }
    window.addEventListener('message', handleMessage);
    frame.addEventListener('load', function () {
      requestHeight();
      setTimeout(requestHeight, 180);
      setTimeout(requestHeight, 800);
    });
    [0, 300, 1000, 2500, 4500].forEach(function (ms) {
      setTimeout(function () { if (!accepted) requestHeight(); }, ms);
    });
    window.addEventListener('resize', requestHeight);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) requestHeight(); });
  }

  function scan(root) {
    if (root && root.matches && root.matches(selector)) initialize(root);
    var containers = (root || document).querySelectorAll(selector);
    for (var i = 0; i < containers.length; i++) initialize(containers[i]);
  }

  function start() {
    scan(document);
    if (typeof MutationObserver === 'function' && document.body) {
      var observer = new MutationObserver(function (changes) {
        changes.forEach(function (change) {
          for (var i = 0; i < change.addedNodes.length; i++) {
            var node = change.addedNodes[i];
            if (node.nodeType === 1) scan(node);
          }
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
