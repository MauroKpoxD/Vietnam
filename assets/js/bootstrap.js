(function (window, document) {
  'use strict';

  if (!window.Utils) {
    console.error('[vn] utils.js no cargó antes que bootstrap.js');
    return;
  }

  const { onReady, pageName, bus } = window.Utils;

  const CONFIG = {
    debug: false,
    version: '3.0.0',
    preloadCritical: true,
    serviceWorker: false
  };

  function log(...args) {
    if (CONFIG.debug) console.log('%c[vn]', 'color:#4dd0e1;font-weight:bold', ...args);
  }
  function warn(...args) { console.warn('[vn]', ...args); }
  function error(...args) { console.error('[vn]', ...args); }

  function safe(name, fn) {
    try {
      if (typeof fn === 'function') { fn(); log('✓', name); return true; }
      warn('módulo no disponible:', name);
      return false;
    } catch (err) {
      error('✗ fallo en', name, err);
      bus.emit('module:error', { name, err });
      return false;
    }
  }

  function detectCapabilities() {
    const html = document.documentElement;
    html.classList.add('js-enabled');
    if ('IntersectionObserver' in window) html.classList.add('has-io');
    if ('ResizeObserver' in window)      html.classList.add('has-ro');
    if ('clipboard' in navigator)        html.classList.add('has-clipboard');
    if ('share' in navigator)            html.classList.add('has-share');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      html.classList.add('reduced-motion');
    }
    if (window.matchMedia('(hover: none)').matches) {
      html.classList.add('is-touch');
    }
    html.classList.add(
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'os-dark' : 'os-light'
    );
  }

  function preloadCritical() {
    if (!CONFIG.preloadCritical) return;
    const imgs = [];
    document.querySelectorAll('img[data-preload]').forEach(img => {
      const src = img.dataset.src || img.src;
      if (src) imgs.push(src);
    });
    if (imgs.length) {
      window.Utils.preloadImages([...new Set(imgs)]).then(() => {
        log('precarga:', imgs.length);
      });
    }
  }

  function initPage() {
    const page = pageName();
    log('página:', page);

    safe('Animaciones.initAll', () => window.Animaciones?.initAll());

    if (page === 'index' || page === '') {
      safe('IndexPage.initAll', () => window.IndexPage?.initAll());
    }

    if (page === 'creditos') {
      safe('CreditosPage.initAll', () => window.CreditosPage?.initAll());
      safe('IndexPage.initLightbox', () => window.IndexPage?.initLightbox());
      safe('IndexPage.initNavToggle', () => window.IndexPage?.initNavToggle());
      safe('IndexPage.initYear', () => window.IndexPage?.initYear());
      safe('IndexPage.initExternalLinks', () => window.IndexPage?.initExternalLinks());
    }

    bus.emit('page:ready', { page });
  }

  function initErrorHandling() {
    window.addEventListener('error', (e) => {
      error('Error global:', e.message, e.filename, e.lineno);
    });
    window.addEventListener('unhandledrejection', (e) => {
      error('Promise rechazada:', e.reason);
    });
  }

  function improveA11y() {
    document.querySelectorAll('nav.links a.active').forEach(a => {
      a.setAttribute('aria-current', 'page');
    });
    document.querySelectorAll('img[data-decorative]').forEach(img => {
      img.setAttribute('alt', '');
      img.setAttribute('role', 'presentation');
    });
  }

  function initServiceWorker() {
    if (!CONFIG.serviceWorker) return;
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  function initGlobalAPI() {
    window.VietnamApp = {
      version: CONFIG.version,
      page: () => pageName(),
      debug: (on = true) => { CONFIG.debug = on; },
      reload: () => location.reload(),
      bus: window.Utils.bus,
      storage: window.Utils.storage,
      modules: () => ({
        Utils:        !!window.Utils,
        Animaciones:  !!window.Animaciones,
        IndexPage:    !!window.IndexPage,
        CreditosPage: !!window.CreditosPage,
        IMAGENES:     !!window.IMAGENES
      })
    };
  }

  function signature() {
    if (!CONFIG.debug) return;
    const style = 'background:#4dd0e1;color:#08202a;padding:4px 10px;border-radius:4px;font-weight:bold;';
    console.log('%cVIETNAM · 1955–1975', style);
  }

  onReady(() => {
    const t0 = performance.now();
    detectCapabilities();
    initErrorHandling();
    initGlobalAPI();
    preloadCritical();
    initPage();
    improveA11y();
    initServiceWorker();
    signature();
    log(`listo en ${(performance.now() - t0).toFixed(1)}ms`);
    bus.emit('app:ready', { duration: performance.now() - t0 });
  });

})(window, document);