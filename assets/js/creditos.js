(function (window, document) {
  'use strict';

  const U = window.Utils || {};
  const {
    $, $$, delegate, debounce, rafThrottle,
    copyToClipboard, storage, prefersReducedMotion
  } = U;

  const state = {
    tipo: 'todas',
    q: '',
    soloFavs: false
  };

  const FAV_KEY = 'vn-favs';
  let favs = new Set(storage.get(FAV_KEY, []));

  const installed = {
    filter:   false,
    busqueda: false,
    sort:     false,
    citas:    false,
    citations:false,
    favs:     false,
    backTop:  false,
    externos: false
  };

  function applyFilters() {
    const items = $$('[data-fuente]');
    let visible = 0;

    items.forEach(el => {
      const lic = el.dataset.fuente || '';
      const id  = el.dataset.favId || '';

      const matchTipo = state.tipo === 'todas' || lic === state.tipo;
      const matchFav  = !state.soloFavs || favs.has(id);
      const matchQ    = !state.q || el.textContent.toLowerCase().includes(state.q);

      const show = matchTipo && matchFav && matchQ;
      el.classList.toggle('is-hidden', !show);
      if (show) visible++;
    });

    const empty = $('[data-filter-empty]');
    if (empty) empty.classList.toggle('hidden', visible > 0);

    const info = $('[data-search-info]');
    if (info) {
      info.textContent = state.q
        ? `${visible} resultado${visible === 1 ? '' : 's'}`
        : '';
    }
  }

  function initFilter() {
    if (installed.filter) return;
    const bar = $('[data-filter-bar]');
    if (!bar) return;
    installed.filter = true;

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tipo]');
      if (!btn) return;
      state.tipo = btn.dataset.tipo;
      $$('[data-tipo]', bar).forEach(b => b.classList.toggle('active', b === btn));
      applyFilters();
    });

    const allBtn = bar.querySelector('[data-tipo="todas"]');
    if (allBtn) allBtn.classList.add('active');
  }

  function initBusqueda() {
    if (installed.busqueda) return;
    const input = $('[data-search]');
    if (!input) return;
    installed.busqueda = true;

    const run = debounce(() => {
      state.q = input.value.trim().toLowerCase();
      applyFilters();
    }, 120);

    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; state.q = ''; applyFilters(); }
    });
  }

  function initSortBy() {
    if (installed.sort) return;
    const sel = $('[data-sort]');
    const container = $('[data-sortable]');
    if (!sel || !container) return;
    installed.sort = true;

    sel.addEventListener('change', () => {
      const by = sel.value;
      const items = $$('[data-fuente]', container).slice();
      items.sort((a, b) => {
        if (by === 'year-desc') return (b.dataset.year || 0) - (a.dataset.year || 0);
        if (by === 'year-asc')  return (a.dataset.year || 0) - (b.dataset.year || 0);
        if (by === 'autor')     return (a.dataset.autor || '').localeCompare(b.dataset.autor || '');
        if (by === 'tipo')      return (a.dataset.fuente || '').localeCompare(b.dataset.fuente || '');
        return 0;
      });
      items.forEach(el => container.appendChild(el));
    });
  }

  function initCopyCitas() {
    if (installed.citas) return;
    installed.citas = true;

    delegate(document, '[data-cita]', 'click', async (e, btn) => {
      const text = btn.dataset.cita;
      const ok = await copyToClipboard(text);
      const orig = btn.textContent;
      btn.textContent = ok ? '✓ Copiado' : '✗ Error';
      btn.classList.add(ok ? 'copied' : 'error');
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('copied', 'error');
      }, 1400);
    });
  }

  function initCitationGenerator() {
    if (installed.citations) return;
    installed.citations = true;

    delegate(document, '[data-cite]', 'click', async (e, btn) => {
      const src = btn.closest('[data-source]');
      if (!src) return;
      const style = btn.dataset.cite;
      const d = src.dataset;

      const autor  = d.autor    || 'Autor desconocido';
      const year   = d.year     || 's.f.';
      const titulo = d.titulo   || 'Sin título';
      const edit   = d.editorial|| '';
      const url    = d.url      || '';
      const acceso = d.fechaAcceso || '';

      let text = '';
      if (style === 'apa') {
        text = `${autor}. (${year}). ${titulo}. ${edit ? edit + '. ' : ''}${url ? 'Recuperado de ' + url : ''}`.trim();
      } else if (style === 'mla') {
        text = `${autor}. "${titulo}." ${edit ? edit + ', ' : ''}${year}.${url ? ' Web. ' + (acceso || '') : ''}`.trim();
      } else if (style === 'chicago') {
        text = `${autor}. "${titulo}." ${edit ? edit + '. ' : ''}${year}.${url ? ' ' + url + (acceso ? ' (' + acceso + ')' : '') + '.' : ''}`.trim();
      }
      if (!text) return;

      const ok = await copyToClipboard(text);
      const out = src.querySelector('[data-cite-output]');
      if (out) {
        out.textContent = text;
        out.classList.add('visible');
      }
      const orig = btn.textContent;
      btn.textContent = ok ? '✓' : '✗';
      setTimeout(() => (btn.textContent = orig), 1200);
    });
  }

  function renderFavs() {
    $$('[data-fav]').forEach(btn => {
      const id = btn.dataset.favId;
      const isFav = favs.has(id);
      btn.classList.toggle('is-fav', isFav);
      btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
      btn.textContent = isFav ? '★' : '☆';
    });
  }

  function initFavorites() {
    favs = new Set(storage.get(FAV_KEY, []));
    renderFavs();

    if (installed.favs) return;
    installed.favs = true;

    delegate(document, '[data-fav]', 'click', (e, btn) => {
      e.stopPropagation();
      const id = btn.dataset.favId;
      if (!id) return;
      if (favs.has(id)) favs.delete(id); else favs.add(id);
      storage.set(FAV_KEY, [...favs]);
      renderFavs();
      if (state.soloFavs) applyFilters();
    });

    const verFav = $('[data-show-favs]');
    if (verFav) {
      verFav.addEventListener('click', () => {
        state.soloFavs = !state.soloFavs;
        verFav.classList.toggle('active', state.soloFavs);
        verFav.textContent = state.soloFavs ? '★ Ver todas' : '★ Ver favoritos';
        applyFilters();
      });
    }
  }

  function initExportBib() {
    delegate(document, '[data-export]', 'click', (e, btn) => {
      const format = btn.dataset.export;
      const items = $$('.biblio li');
      if (!items.length) return;

      let content = '';
      if (format === 'bib') {
        content = items.map((li, i) => {
          const clone = li.cloneNode(true);
          clone.querySelectorAll('.ext-icon, [data-fav]').forEach(x => x.remove());
          const txt = (clone.textContent || '').trim().replace(/\s+/g, ' ');
          const safe = txt.replace(/[{}]/g, '').replace(/%/g, '\\%');
          return `@misc{ref${i + 1},\n  note = {${safe}}\n}`;
        }).join('\n\n');
      } else {
        content = items.map((li, i) => {
          const clone = li.cloneNode(true);
          clone.querySelectorAll('.ext-icon, [data-fav]').forEach(x => x.remove());
          return `[${i + 1}] ${(clone.textContent || '').trim()}`;
        }).join('\n\n');
      }

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = format === 'bib'
        ? 'bibliografia-vietnam.bib'
        : 'bibliografia-vietnam.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  function initBackTop() {
    if (installed.backTop) return;
    installed.backTop = true;

    let btn = $('.back-top');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'back-top';
      btn.setAttribute('aria-label', 'Volver arriba');
      btn.textContent = '↑';
      document.body.appendChild(btn);
    }
    const update = rafThrottle(() => {
      btn.classList.toggle('visible', (window.scrollY || 0) > 400);
    });
    window.addEventListener('scroll', update, { passive: true });
    update();
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
  }

  function initExternalLinks() {
    if (installed.externos) return;
    installed.externos = true;

    $$('a[href^="http"]').forEach(a => {
      try {
        const u = new URL(a.href);
        if (u.origin === location.origin) return;
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        if (!a.querySelector('.ext-icon') && a.dataset.noIcon !== 'true') {
          const i = document.createElement('span');
          i.className = 'ext-icon';
          i.setAttribute('aria-hidden', 'true');
          i.textContent = '↗';
          a.appendChild(i);
        }
      } catch {}
    });
  }

  window.CreditosPage = {
    initFilter,
    initBusqueda,
    initSortBy,
    initCopyCitas,
    initCitationGenerator,
    initFavorites,
    initExportBib,
    initBackTop,
    initExternalLinks,
    applyFilters,
    renderFavs,
    initAll() {
      initFilter();
      initBusqueda();
      initSortBy();
      initCopyCitas();
      initCitationGenerator();
      initFavorites();
      initExportBib();
      initBackTop();
      initExternalLinks();
      applyFilters();
    }
  };
})(window, document);