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
    // The shortcode owns the menu; the cross-origin iframe owns form content.
    // Only allowlisted section identifiers travel to the exact trusted Worker origin.
    var sections = ['inicio', 'consumidor', 'bien', 'reclamo', 'informacion', 'enviar'];
    var nav = container.querySelector('.lirep-public-nav');
    var toggle = container.querySelector('.lirep-public-toggle');
    var shade = container.querySelector('.lirep-public-shade');
    var previousFocus = null;
    function closeMenu() {
      if (!nav || !toggle || !shade) return;
      nav.setAttribute('data-open', 'false');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Abrir menú del Libro de Reclamaciones');
      shade.hidden = true;
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      previousFocus = null;
    }
    function openMenu() {
      if (!nav || !toggle || !shade) return;
      previousFocus = document.activeElement || toggle;
      nav.setAttribute('data-open', 'true');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Cerrar menú del Libro de Reclamaciones');
      shade.hidden = false;
      var first = nav.querySelector('button[data-lirep-go]');
      if (first && first.focus) first.focus();
    }
    if (nav && toggle && shade && nav.querySelectorAll) {
      toggle.addEventListener('click', function () {
        if (nav.getAttribute('data-open') === 'true') closeMenu();
        else openMenu();
      });
      shade.addEventListener('click', closeMenu);
      nav.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
        if (event.key !== 'Tab' || nav.getAttribute('data-open') !== 'true') return;
        var buttons = Array.prototype.slice.call(nav.querySelectorAll('button[data-lirep-go]'));
        if (!buttons.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault(); buttons[buttons.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
          event.preventDefault(); buttons[0].focus();
        }
      });
      nav.addEventListener('click', function (event) {
        var button = event.target && event.target.closest && event.target.closest('button[data-lirep-go]');
        if (!button) return;
        var section = button.getAttribute('data-lirep-go');
        if (sections.indexOf(section) < 0) return;
        var buttons = nav.querySelectorAll('button[data-lirep-go]');
        for (var i = 0; i < buttons.length; i++) {
          if (buttons[i] === button) buttons[i].setAttribute('aria-current', 'step');
          else buttons[i].removeAttribute('aria-current');
        }
        closeMenu();
        if (frame.contentWindow) frame.contentWindow.postMessage({type:'lirep:navigate',prefix:prefix,section:section},origin);
      });
      window.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && nav.getAttribute('data-open') === 'true') closeMenu();
      });
      window.addEventListener('resize', function () {
        if (window.innerWidth > 900 && nav.getAttribute('data-open') === 'true') closeMenu();
      });
    }

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
      if (!data || data.prefix !== prefix) return;
      if (data.type === 'lirep:section') {
        if (sections.indexOf(data.section) < 0) return;
        var offset = Number(data.offset);
        if (!Number.isFinite(offset) || offset < 0 || offset > 15000) return;
        if (frame.getBoundingClientRect && typeof window.scrollTo === 'function') {
          var top = frame.getBoundingClientRect().top + (window.scrollY || 0) + offset - 24;
          window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
        }
        return;
      }
      if (data.type !== 'lirep:resize') return;
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
