(function (window, document) {
  'use strict';

  const U = window.Utils || {};
  const { onReady, shuffle } = U;

  const CONFIG = {
    jsonUrl:      'assets/json/imagenes.json',
    apiUrl:       'https://commons.wikimedia.org/w/api.php',
    filePathBase: 'https://commons.wikimedia.org/wiki/Special:FilePath/',
    localBase:    'assets/img/wm/',
    thumbWidth:   800,
    thumbSmall:   400,
    cacheKey:     'vn-imagenes-cache-v7',
    cacheTTL:     7 * 24 * 60 * 60 * 1000,
    batchSize:    20,
    maxConcurrentBatches: 3,
    retryAttempts: 3,
    retryBaseDelay: 400,
    lazyRootMargin: '200px 0px'
  };

  const PLACEHOLDER_SVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1e1e1e"/>
          <stop offset="1" stop-color="#2a2a2a"/>
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#g)"/>
      <g fill="none" stroke="#4dd0e1" stroke-opacity="0.35" stroke-width="2">
        <circle cx="400" cy="270" r="60"/>
        <path d="M340 270 L460 270 M400 210 L400 330"/>
      </g>
      <text x="400" y="380" fill="#7d97a4" font-family="sans-serif"
            font-size="20" text-anchor="middle" letter-spacing="2">
        IMAGEN NO DISPONIBLE
      </text>
      <text x="400" y="410" fill="#4dd0e1" font-family="sans-serif"
            font-size="14" text-anchor="middle" letter-spacing="1">
        Wikimedia Commons
      </text>
    </svg>
  `)}`;

  let db = null;
  let dbMeta = null;
  let urlMap = {};
  let tagIndex = {};
  let loading = null;
  let listeners = {};

  const usedIds = new Set();

  const hasIO = typeof IntersectionObserver !== 'undefined';

  let isOnline = (typeof navigator !== 'undefined') ? navigator.onLine !== false : true;
  window.addEventListener('online',  () => { isOnline = true; });
  window.addEventListener('offline', () => { isOnline = false; });

  /* ==============================================================
     LAZY OBSERVER
     ============================================================== */
  let lazyObserver = null;

  if (hasIO) {
    lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        const src = img.dataset.src;
        if (src) {
          img.src = src;
          delete img.dataset.src;
        }
        lazyObserver.unobserve(img);
      });
    }, { rootMargin: CONFIG.lazyRootMargin });
  }

  function markLoaded(img) {
    img.classList.add('is-loaded');
  }

  /* ==============================================================
     HELPERS
     ============================================================== */
  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function encodeFilename(name) {
    return encodeURIComponent(name)
      .replace(/%2C/gi, ',')
      .replace(/%28/gi, '(')
      .replace(/%29/gi, ')');
  }

  function normalizeTitle(t) {
    return String(t)
      .replace(/^File:/i, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /* ==============================================================
     CONCURRENCIA + RETRY
     ============================================================== */
  async function withConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let idx = 0;
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (idx < tasks.length) {
        const i = idx++;
        try {
          results[i] = { status: 'fulfilled', value: await tasks[i]() };
        } catch (err) {
          results[i] = { status: 'rejected', reason: err };
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  async function fetchWithRetry(url, attempts = CONFIG.retryAttempts) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await sleep(CONFIG.retryBaseDelay * Math.pow(2, i));
      }
    }
    throw lastErr;
  }

  /* ==============================================================
     ÍNDICE POR TAGS
     ============================================================== */
  function buildTagIndex() {
    tagIndex = {};
    (db || []).forEach(item => {
      const tags = Array.isArray(item.tags) ? item.tags : ['general'];
      tags.forEach(tag => {
        if (!tagIndex[tag]) tagIndex[tag] = [];
        tagIndex[tag].push(item);
      });
    });
  }

  /* ==============================================================
     CARGA DEL JSON + API
     ============================================================== */
  function cargarJSON() {
    if (loading) return loading;
    loading = _cargar();
    return loading;
  }

  async function _cargar() {
    if (db) return db;

    const cache = leerCache();
    if (cache) {
      db = cache.imagenes;
      dbMeta = cache.meta;
      urlMap = cache.urlMap || {};
      buildTagIndex();
      return db;
    }

    if (!isOnline) {
      const stale = leerCache(true);
      if (stale) {
        db = stale.imagenes;
        dbMeta = stale.meta;
        urlMap = stale.urlMap || {};
        buildTagIndex();
        return db;
      }
    }

    const res = await fetch(CONFIG.jsonUrl);
    if (!res.ok) throw new Error(`No se pudo cargar ${CONFIG.jsonUrl} (${res.status})`);
    const data = await res.json();

    db = data.imagenes || [];
    dbMeta = data.meta || { total: db.length };
    buildTagIndex();

    let apiOk = true;
    try {
      urlMap = await resolverUrls(db);
    } catch (err) {
      console.warn('[imagenes] API falló, usando fallback');
      urlMap = {};
      apiOk = false;
    }

    if (apiOk) guardarCache(data);
    return db;
  }

  function leerCache(ignoreTTL = false) {
    try {
      const raw = localStorage.getItem(CONFIG.cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.timestamp) return null;
      if (!ignoreTTL && Date.now() - parsed.timestamp > CONFIG.cacheTTL) return null;
      return parsed.data;
    } catch { return null; }
  }

  function guardarCache(data) {
    try {
      localStorage.setItem(CONFIG.cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data: { ...data, urlMap }
      }));
    } catch (err) {
      console.warn('[imagenes] localStorage lleno');
    }
  }

  async function resolverUrls(items) {
    if (!isOnline) return {};

    const archivos = items.map(i => i.archivo).filter(Boolean);
    if (!archivos.length) return {};

    const batches = chunk(archivos, CONFIG.batchSize);
    const resolved = {};

    const tasks = batches.map(batch => () => queryBatch(batch));
    const results = await withConcurrency(tasks, CONFIG.maxConcurrentBatches);

    let failedCount = 0;
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        Object.assign(resolved, r.value);
      } else {
        failedCount++;
        console.warn('[imagenes] batch', i, 'falló:', r.reason);
      }
    });

    if (failedCount === batches.length) {
      throw new Error('Todos los batches fallaron');
    }

    return resolved;
  }

  async function queryBatch(batch) {
    const titles = batch.map(f => `File:${f}`).join('|');
    const url = `${CONFIG.apiUrl}?` +
      `action=query&format=json&origin=*` +
      `&prop=imageinfo&iiprop=url&iiurlwidth=${CONFIG.thumbWidth}` +
      `&redirects=1` +
      `&titles=${encodeURIComponent(titles)}`;

    const res = await fetchWithRetry(url);
    const data = await res.json();

    const norm = {};
    (data.query?.normalized || []).forEach(n => {
      norm[normalizeTitle(n.to)] = normalizeTitle(n.from);
    });
    (data.query?.redirects || []).forEach(r => {
      const to = normalizeTitle(r.to);
      const from = normalizeTitle(r.from);
      norm[to] = norm[from] || from;
    });

    const resolved = {};

    Object.values(data.query?.pages || {}).forEach(page => {
      if (page.missing !== undefined) return;
      const info = page.imageinfo?.[0];
      if (!info) return;

      const apiTitle = normalizeTitle(page.title);
      const payload = {
        thumb: info.thumburl || info.url,
        full: info.url || info.thumburl,
        exists: true
      };

      resolved[apiTitle] = payload;
      resolved[apiTitle.replace(/ /g, '_')] = payload;
      const originalFrom = norm[apiTitle];
      if (originalFrom) {
        resolved[originalFrom] = payload;
        resolved[originalFrom.replace(/ /g, '_')] = payload;
      }
    });

    batch.forEach(f => {
      const key = normalizeTitle(f);
      const keyUS = key.replace(/ /g, '_');
      if (!resolved[key] && !resolved[keyUS] && !resolved[f]) {
        resolved[f] = { exists: false };
      }
    });

    return resolved;
  }

  /* ==============================================================
     LOOKUP Y URLs
     ============================================================== */
  function lookupUrl(archivo) {
    if (!archivo) return null;
    if (urlMap[archivo]) return urlMap[archivo];
    const key = normalizeTitle(archivo);
    if (urlMap[key]) return urlMap[key];
    const keyUS = key.replace(/ /g, '_');
    if (urlMap[keyUS]) return urlMap[keyUS];
    return null;
  }

  function urlImagen(archivo, ancho = CONFIG.thumbWidth) {
    if (!archivo) return PLACEHOLDER_SVG;
    const r = lookupUrl(archivo);
    if (r) {
      if (!r.exists) return PLACEHOLDER_SVG;
      return ancho <= CONFIG.thumbWidth ? r.thumb : r.full;
    }
    return `${CONFIG.filePathBase}${encodeFilename(archivo)}?width=${ancho}`;
  }

  function urlFull(archivo) {
    if (!archivo) return PLACEHOLDER_SVG;
    const r = lookupUrl(archivo);
    if (r) {
      if (!r.exists) return PLACEHOLDER_SVG;
      return r.full;
    }
    return `${CONFIG.filePathBase}${encodeFilename(archivo)}`;
  }

  function urlLocal(archivo) {
    if (!archivo) return PLACEHOLDER_SVG;
    return CONFIG.localBase + archivo;
  }

  function urlPagina(pagina, archivo) {
    if (pagina) return pagina;
    return `https://commons.wikimedia.org/wiki/File:${encodeFilename(archivo)}`;
  }

  /* ==============================================================
     SELECCIÓN CON ANTI-REPETICIÓN
     ============================================================== */
  function drawUnique(n, filtro = null) {
    if (!db || !db.length || n <= 0) return [];

    let basePool = db.filter(item => {
      const r = lookupUrl(item.archivo);
      return r ? r.exists : true;
    });

    if (typeof filtro === 'function') basePool = basePool.filter(filtro);
    if (!basePool.length) return [];

    const result = [];

    const disponibles = basePool.filter(it => !usedIds.has(it.id));
    const shuffledAvail = shuffle(disponibles);

    for (const item of shuffledAvail) {
      if (result.length >= n) break;
      result.push(item);
      usedIds.add(item.id);
    }

    if (result.length < n) {
      usedIds.clear();
      result.forEach(it => usedIds.add(it.id));

      const restantes = shuffle(basePool.filter(it => !usedIds.has(it.id)));
      for (const item of restantes) {
        if (result.length >= n) break;
        result.push(item);
        usedIds.add(item.id);
      }
    }

    return result;
  }

  function resetUsed() {
    usedIds.clear();
  }

  function getUsedCount() {
    return usedIds.size;
  }

  /* ==============================================================
     CREAR TARJETA
     ============================================================== */
  function crearTarjeta(item, opts = {}) {
    const { lazy = true, badge = '', className = '' } = opts;

    const r = lookupUrl(item.archivo);
    const existe = r ? r.exists : true;

    const urlRemote   = urlImagen(item.archivo);
    const urlLocalStr = urlLocal(item.archivo);
    const urlOriginal = `${CONFIG.filePathBase}${encodeFilename(item.archivo)}`;
    const urlInicial  = (!isOnline && existe) ? urlLocalStr : urlRemote;

    const fig = document.createElement('figure');
    fig.className = `foto ${className}`.trim();
    fig.dataset.full  = urlFull(item.archivo);
    fig.dataset.local = urlLocalStr;
    fig.dataset.cap   = `${item.titulo} · ${item.anio} · ${item.credito}`;
    fig.dataset.id    = item.id;
    if (item.tags) fig.dataset.tags = item.tags.join(',');

    const img = document.createElement('img');
    img.alt = item.titulo;
    img.decoding = 'async';

    if (!existe) {
      fig.dataset.missing = '1';
      img.src = PLACEHOLDER_SVG;
      img.classList.add('is-placeholder');
      img.classList.add('is-loaded');
    } else {
      let step = 0;
      const triedUrls = new Set([urlInicial]);

      img.addEventListener('error', () => {
        step++;
        let next;
        if (step === 1) next = urlLocalStr;
        else if (step === 2) next = urlOriginal;
        else next = PLACEHOLDER_SVG;

        if (triedUrls.has(next)) next = PLACEHOLDER_SVG;
        triedUrls.add(next);

        img.src = next;
        if (next === PLACEHOLDER_SVG) {
          img.classList.add('is-placeholder');
          img.classList.add('is-loaded');
          fig.dataset.localFallback = 'failed';
        }
      });

      img.addEventListener('load', () => {
        fig.dataset.source = img.src.includes(CONFIG.localBase) ? 'local' : 'remote';
        markLoaded(img);
      });

      if (lazy && hasIO) {
        img.classList.add('lazy');
        img.dataset.src = urlInicial;
        lazyObserver.observe(img);
      } else {
        img.src = urlInicial;
      }
    }

    fig.appendChild(img);

    if (badge) {
      const b = document.createElement('span');
      b.className = `badge ${badge}`.trim();
      b.textContent = String(item.anio || '');
      fig.appendChild(b);
    }

    const cap = document.createElement('figcaption');
    cap.className = 'cap';
    const bEl = document.createElement('b');
    bEl.textContent = item.titulo || '';
    cap.appendChild(bEl);
    cap.appendChild(document.createTextNode(
      `${item.credito || ''} · ${item.licencia || ''}`
    ));
    fig.appendChild(cap);

    return fig;
  }

  /* ==============================================================
     ROTACIÓN
     ============================================================== */
  async function rotarEn(contenedor, cantidad = 8, opts = {}) {
    const el = typeof contenedor === 'string'
      ? document.querySelector(contenedor)
      : contenedor;
    if (!el) return;

    await cargarJSON();

    let seleccion;
    if (opts.tag) {
      const tag = opts.tag;
      seleccion = drawUnique(cantidad, (it) => (it.tags || []).includes(tag));
    } else {
      seleccion = drawUnique(cantidad, opts.filtro);
    }

    el.innerHTML = '';

    if (!seleccion.length) {
      el.dataset.state = 'empty';
      return;
    }

    const frag = document.createDocumentFragment();
    seleccion.forEach(item => frag.appendChild(crearTarjeta(item, opts)));
    el.appendChild(frag);
    el.dataset.state = 'loaded';

    if (window.Animaciones?.initScrollReveal) window.Animaciones.initScrollReveal();
    if (window.IndexPage?.refreshLightboxItems) window.IndexPage.refreshLightboxItems();
  }

  async function rotarTodo() {
    await cargarJSON();

    resetUsed();

    const contenedores = Array.from(document.querySelectorAll('[data-rotar]'));
    for (const el of contenedores) {
      const cantidad = parseInt(el.dataset.rotar || '6', 10);
      const tag = el.dataset.tag || null;
      const filtro = el.dataset.filtro || null;
      await rotarEn(el, cantidad, {
        tag,
        filtro: filtro ? (it) => (it.tags || []).includes(filtro) : null,
        badge: el.dataset.badge || ''
      });
    }
  }

  /* ==============================================================
     CRÉDITOS
     ============================================================== */
  async function listarCreditos() {
    await cargarJSON();
    const vistos = new Set();
    const lista = [];
    (db || []).forEach(item => {
      const key = item.pagina || item.archivo;
      if (vistos.has(key)) return;
      vistos.add(key);

      const r = lookupUrl(item.archivo);
      const existe = r ? r.exists : true;

      lista.push({
        id: item.id,
        titulo: item.titulo,
        archivo: item.archivo,
        anio: item.anio,
        credito: item.credito,
        licencia: item.licencia,
        tags: item.tags || [],
        pagina: urlPagina(item.pagina, item.archivo),
        url: existe ? urlImagen(item.archivo, CONFIG.thumbSmall) : PLACEHOLDER_SVG,
        urlLocal: urlLocal(item.archivo),
        existe
      });
    });
    return lista;
  }

  async function resumenLicencias() {
    await cargarJSON();
    const resumen = {};
    (db || []).forEach(item => {
      const r = lookupUrl(item.archivo);
      if (r && !r.exists) return;
      const lic = item.licencia || 'Sin licencia';
      resumen[lic] = (resumen[lic] || 0) + 1;
    });
    return resumen;
  }

  async function resumenTags() {
    await cargarJSON();
    const resumen = {};
    Object.entries(tagIndex).forEach(([tag, items]) => {
      const count = items.filter(item => {
        const r = lookupUrl(item.archivo);
        return r ? r.exists : true;
      }).length;
      if (count > 0) resumen[tag] = count;
    });
    return resumen;
  }

  /* ==============================================================
     HELPERS PÚBLICOS
     ============================================================== */
  function getTotal() {
    if (!db) return 0;
    return db.filter(i => {
      const r = lookupUrl(i.archivo);
      return r ? r.exists : true;
    }).length;
  }
  function getTotalRaw() { return db ? db.length : 0; }
  function getMeta() { return dbMeta; }
  function getDB() { return db; }
  function getTags() { return Object.keys(tagIndex); }

  function buscar(termino) {
    if (!db) return [];
    const q = String(termino).toLowerCase();
    return db.filter(item =>
      String(item.titulo || '').toLowerCase().includes(q) ||
      String(item.credito || '').toLowerCase().includes(q) ||
      String(item.anio || '').includes(q) ||
      (item.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  async function reporteMissing() {
    await cargarJSON();
    const missing = (db || []).filter(i => {
      const r = lookupUrl(i.archivo);
      return r && !r.exists;
    });
    const ok = (db || []).filter(i => {
      const r = lookupUrl(i.archivo);
      return r && r.exists;
    });

    console.group('%c[imagenes] Reporte', 'color:#4dd0e1;font-weight:bold');
    console.log(`Existen: ${ok.length} / ${db.length}`);
    console.log(`Faltan:  ${missing.length}`);
    if (missing.length) {
      console.table(missing.map(m => ({ id: m.id, archivo: m.archivo, titulo: m.titulo })));
    }
    console.groupEnd();
    return { ok, missing };
  }

  async function verificarLocal() {
    await cargarJSON();
    const lista = await Promise.all((db || []).map(item => {
      return new Promise(resolve => {
        const img = new Image();
        img.onload  = () => resolve({ id: item.id, archivo: item.archivo, ok: true });
        img.onerror = () => resolve({ id: item.id, archivo: item.archivo, ok: false });
        img.src = urlLocal(item.archivo);
      });
    }));
    const ok = lista.filter(x => x.ok);
    const missing = lista.filter(x => !x.ok);
    console.group('%c[imagenes] Local', 'color:#4dd0e1;font-weight:bold');
    console.log(`Locales OK:     ${ok.length} / ${lista.length}`);
    console.log(`Faltan locales: ${missing.length}`);
    if (missing.length) console.table(missing);
    console.groupEnd();
    return { ok, missing };
  }

  function isOffline() { return !isOnline; }

  /* ==============================================================
     EVENTOS INTERNOS
     ============================================================== */
  function on(evt, fn) {
    if (!listeners[evt]) listeners[evt] = new Set();
    listeners[evt].add(fn);
    return () => listeners[evt].delete(fn);
  }
  function emit(evt, payload) {
    listeners[evt]?.forEach(fn => {
      try { fn(payload); } catch (e) { console.error('[imagenes]', evt, e); }
    });
  }

  /* ==============================================================
     INIT
     ============================================================== */
  function init() {
    if (typeof onReady !== 'function') return;
    onReady(async () => {
      try {
        await cargarJSON();
        if (document.querySelector('[data-rotar]')) {
          await rotarTodo();
        }
        const info = {
          total: getTotal(),
          totalRaw: getTotalRaw(),
          tags: getTags(),
          online: isOnline
        };
        window.Utils?.bus?.emit('imagenes:ready', info);
        emit('ready', info);
      } catch (err) {
        console.warn('[imagenes] Error al cargar:', err);
        window.Utils?.bus?.emit('imagenes:error', err);
        emit('error', err);
      }
    });
  }

  if (window.Utils?.bus) {
    window.Utils.bus.on('imagenes:ready', ({ total }) => {
      document.querySelectorAll('[data-imagenes-total]').forEach(el => {
        el.textContent = total;
      });
    });
  }

  /* ==============================================================
     API PÚBLICA
     ============================================================== */
  window.IMAGENES = {
    cargar: cargarJSON,
    getDB, getMeta, getTotal, getTotalRaw, getTags,
    buscar,
    urlImagen, urlFull, urlLocal, urlPagina,
    crearTarjeta, rotarEn, rotarTodo,
    drawUnique, resetUsed, getUsedCount,
    listarCreditos, resumenLicencias, resumenTags,
    reporteMissing, verificarLocal, isOffline,
    on, off: (evt, fn) => listeners[evt]?.delete(fn),
    PLACEHOLDER: PLACEHOLDER_SVG,
    CONFIG,
    init
  };

  init();

})(window, document);
