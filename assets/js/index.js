(function (window, document) {
  'use strict';

  const {
    $, $$, on, delegate, onReady,
    debounce, throttle, rafThrottle, wait,
    clamp, prefersReducedMotion, scrollToEl, lockScroll, unlockScroll,
    copyToClipboard, preloadImages, formatNumber
  } = window.Utils;

  function initNavToggle() {
    const header = $('header');
    const toggle = $('.navtoggle');
    if (!header || !toggle) return;

    let lastFocus = null;

    function open() {
      header.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      lastFocus = document.activeElement;
      const first = header.querySelector('nav.links a');
      if (first) first.focus();
    }
    function close() {
      header.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      if (lastFocus) lastFocus.focus();
    }

    toggle.addEventListener('click', () => {
      header.classList.contains('open') ? close() : open();
    });

    delegate(header.querySelector('nav.links') || header, 'a', 'click', close);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && header.classList.contains('open')) close();
    });

    window.addEventListener('scroll', debounce(() => {
      if (header.classList.contains('open') && (window.scrollY || 0) > 100) close();
    }, 150), { passive: true });
  }

  function initSidebar() {
    const sections = $$('section[data-title]');
    if (!sections.length) return;

    $('.sidebar')?.remove();

    const sidebar = document.createElement('nav');
    sidebar.className = 'sidebar';
    sidebar.setAttribute('aria-label', 'Navegación de secciones');
    sidebar.setAttribute('aria-hidden', 'true');

    sections.forEach((sec, i) => {
      if (!sec.id) sec.id = 'sec-' + i;
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dot';
      dot.dataset.target = sec.id;
      dot.dataset.label = sec.dataset.title;
      dot.setAttribute('aria-label', `Ir a ${sec.dataset.title}`);
      dot.addEventListener('click', () => scrollToEl(sec, 90));
      sidebar.appendChild(dot);
    });
    document.body.appendChild(sidebar);

    const toggleVisibility = rafThrottle(() => {
      const visible = (window.scrollY || 0) > 220;
      sidebar.classList.toggle('visible', visible);
      sidebar.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
    window.addEventListener('scroll', toggleVisibility, { passive: true });
    toggleVisibility();

    const dots = $$('.sidebar .dot', sidebar);
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          dots.forEach(d => d.classList.toggle('active', d.dataset.target === id));
        }
      });
    }, { threshold: 0.35, rootMargin: '-15% 0px -55% 0px' });
    sections.forEach(sec => io.observe(sec));
  }

  function initActiveNav() {
    const sections = $$('section[id]');
    const links = $$('nav.links a[href^="#"]');
    if (!sections.length || !links.length) return;

    const map = new Map();
    links.forEach(l => {
      const id = l.getAttribute('href').slice(1);
      const sec = document.getElementById(id);
      if (sec) map.set(sec, l);
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const link = map.get(entry.target);
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach(l => l.classList.remove('active'));
          link.classList.add('active');
        }
      });
    }, { threshold: 0.4, rootMargin: '-20% 0px -50% 0px' });
    map.forEach((_, sec) => io.observe(sec));
  }

  function initSmoothScroll() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (id === '#' || id.length < 2) return;
      const target = document.getElementById(id.slice(1));
      if (!target) return;
      e.preventDefault();
      scrollToEl(target, 90);
      history.replaceState(null, '', id);
    });
  }

  function initHashNavigation() {
    if (!location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    setTimeout(() => scrollToEl(target, 90), 350);
  }

  function refreshLightboxItems() {
    $$('.foto, .galeria-item, [data-lightbox]').forEach(item => {
      if (item.dataset.lbReady === '1') return;
      item.dataset.lbReady = '1';
      item.setAttribute('tabindex', '0');
      item.setAttribute('role', 'button');
    });
  }

  function initLightbox() {
    let lb = $('.lightbox');
    let imgEl, capEl, counter, btnClose, btnPrev, btnNext;
    let current = 0;
    let lastFocus = null;
    let touchStartX = 0;

    function getItems() {
      return $$('.foto, .galeria-item, [data-lightbox]');
    }

    function render(index) {
      const items = getItems();
      if (!items.length) return;
      current = (index + items.length) % items.length;
      const item = items[current];
      const img  = $('img', item);
      const cap  = item.dataset.cap || (img ? img.alt : '');
      const full = item.dataset.full || (img ? img.src : '');

      imgEl.src = full;
      imgEl.alt = cap;
      capEl.textContent = cap || '';
      counter.textContent = `${current + 1} / ${items.length}`;

      const nextItem = items[(current + 1) % items.length];
      const prevItem = items[(current - 1 + items.length) % items.length];
      preloadImages([
        nextItem.dataset.full || $('img', nextItem)?.src,
        prevItem.dataset.full || $('img', prevItem)?.src
      ].filter(Boolean));
    }

    function open(index) {
      lastFocus = document.activeElement;
      render(index);
      lb.classList.add('open');
      lb.setAttribute('aria-hidden', 'false');
      lockScroll();
      btnClose.focus();
      history.replaceState(null, '', '#foto-' + current);
    }

    function close() {
      lb.classList.remove('open');
      lb.setAttribute('aria-hidden', 'true');
      unlockScroll();
      if (lastFocus) lastFocus.focus();
    }

    function next() { render(current + 1); }
    function prev() { render(current - 1); }

    if (!lb) {
      lb = document.createElement('div');
      lb.className = 'lightbox';
      lb.setAttribute('role', 'dialog');
      lb.setAttribute('aria-modal', 'true');
      lb.setAttribute('aria-hidden', 'true');
      lb.innerHTML = `
        <button class="lightbox-close" aria-label="Cerrar">×</button>
        <button class="lightbox-arrow prev" aria-label="Anterior">‹</button>
        <button class="lightbox-arrow next" aria-label="Siguiente">›</button>
        <div class="lightbox-inner">
          <img src="" alt="">
          <div class="lightbox-cap"></div>
          <div class="lightbox-counter"></div>
        </div>
      `;
      document.body.appendChild(lb);

      imgEl    = $('img', lb);
      capEl    = $('.lightbox-cap', lb);
      counter  = $('.lightbox-counter', lb);
      btnClose = $('.lightbox-close', lb);
      btnPrev  = $('.lightbox-arrow.prev', lb);
      btnNext  = $('.lightbox-arrow.next', lb);

      btnClose.addEventListener('click', close);
      btnNext.addEventListener('click', next);
      btnPrev.addEventListener('click', prev);
      lb.addEventListener('click', (e) => { if (e.target === lb) close(); });

      document.addEventListener('keydown', (e) => {
        if (!lb.classList.contains('open')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowRight') next();
        if (e.key === 'ArrowLeft') prev();
        if (e.key === 'Home') render(0);
        if (e.key === 'End') render(getItems().length - 1);
      });

      lb.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const focusables = $$('button', lb);
        const first = focusables[0];
        const last  = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      });

      lb.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });
      lb.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].screenX - touchStartX;
        if (Math.abs(dx) > 50) dx < 0 ? next() : prev();
      }, { passive: true });

      document.addEventListener('click', (e) => {
        const item = e.target.closest('.foto, .galeria-item, [data-lightbox]');
        if (!item) return;
        const items = getItems();
        const i = items.indexOf(item);
        if (i >= 0) open(i);
      });

      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const item = e.target.closest('.foto, .galeria-item, [data-lightbox]');
        if (!item) return;
        e.preventDefault();
        const items = getItems();
        const i = items.indexOf(item);
        if (i >= 0) open(i);
      });
    }

    refreshLightboxItems();
  }

  function initYear() {
    const y = new Date().getFullYear();
    $$('[data-year]').forEach(el => (el.textContent = y));
  }

  function initAnchorCopy() {
    if (!navigator.clipboard && !document.queryCommandSupported) return;

    $$('section[id] h2').forEach(h2 => {
      const sec = h2.closest('section');
      if (!sec || !sec.id) return;
      if (h2.querySelector('.copy-anchor')) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-anchor';
      btn.setAttribute('aria-label', 'Copiar enlace a esta sección');
      btn.textContent = '#';
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const url = `${location.origin}${location.pathname}#${sec.id}`;
        const ok = await copyToClipboard(url);
        btn.textContent = ok ? '✓' : '✗';
        setTimeout(() => (btn.textContent = '#'), 1400);
      });
      h2.appendChild(btn);
    });
  }

  function initLazyVideos() {
    const vids = $$('video[data-autoplay]');
    if (!vids.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const v = entry.target;
        if (entry.isIntersecting) v.play().catch(() => {});
        else v.pause();
      });
    }, { threshold: 0.4 });
    vids.forEach(v => {
      v.muted = true; v.loop = true; v.playsInline = true;
      io.observe(v);
    });
  }

  function initTOC() {
    const slot = $('[data-toc]');
    if (!slot) return;

    const heads = $$('section[id] > .wrap > .section-head > h2, section[id] h2[id]');
    if (!heads.length) return;

    const nav = document.createElement('nav');
    nav.className = 'toc';
    nav.setAttribute('aria-label', 'Índice');

    const list = document.createElement('ol');
    heads.forEach((h, i) => {
      if (!h.id) h.id = 'h-' + i;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent.replace('#', '').trim();
      li.appendChild(a);
      list.appendChild(li);
    });
    nav.appendChild(list);
    slot.innerHTML = '';
    slot.appendChild(nav);
  }

  function initQuiz() {
    $$('[data-quiz]').forEach(quiz => {
      const questions = $$('[data-quiz-q]', quiz);
      let score = 0;
      let answered = 0;

      questions.forEach(q => {
        const correct = parseInt(q.dataset.correct, 10);
        const opts = $$('[data-opt]', q);

        opts.forEach((opt, i) => {
          opt.addEventListener('click', () => {
            if (q.dataset.done === '1') return;
            q.dataset.done = '1';
            answered++;

            if (i === correct) {
              opt.classList.add('correct');
              score++;
            } else {
              opt.classList.add('wrong');
              opts[correct]?.classList.add('correct');
            }
            opts.forEach(o => o.setAttribute('disabled', 'true'));

            const feedback = q.querySelector('[data-feedback]');
            if (feedback) {
              feedback.textContent = i === correct
                ? (feedback.dataset.ok || '¡Correcto!')
                : (feedback.dataset.ko || 'Incorrecto.');
              feedback.classList.add('visible');
            }

            if (answered === questions.length) {
              const result = quiz.querySelector('[data-quiz-result]');
              if (result) {
                const pct = Math.round((score / questions.length) * 100);
                result.textContent = `Resultado: ${score} / ${questions.length} (${pct}%)`;
                result.classList.add('visible');
              }
            }
          });
        });
      });

      const reset = quiz.querySelector('[data-quiz-reset]');
      if (reset) {
        reset.addEventListener('click', () => {
          score = 0; answered = 0;
          questions.forEach(q => {
            q.dataset.done = '';
            $$('[data-opt]', q).forEach(o => {
              o.classList.remove('correct', 'wrong');
              o.removeAttribute('disabled');
            });
            const fb = q.querySelector('[data-feedback]');
            if (fb) fb.classList.remove('visible');
          });
          const result = quiz.querySelector('[data-quiz-result]');
          if (result) result.classList.remove('visible');
        });
      }
    });
  }

  function initInteractiveTimeline() {
    $$('[data-timeline]').forEach(tl => {
      const range = tl.querySelector('[data-timeline-range]');
      const steps = $$('[data-timeline-step]', tl);
      if (!range || !steps.length) return;

      range.max = steps.length - 1;
      range.value = 0;

      function show(i) {
        steps.forEach((s, idx) => s.classList.toggle('active', idx === i));
      }

      range.addEventListener('input', () => show(parseInt(range.value, 10)));

      steps.forEach((s, i) => {
        s.addEventListener('click', () => {
          range.value = i;
          show(i);
        });
      });
      show(0);
    });
  }

  function initShareButtons() {
    $$('[data-share]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const data = {
          title: btn.dataset.shareTitle || document.title,
          text: btn.dataset.shareText  || '',
          url:  btn.dataset.shareUrl   || location.href
        };
        if (navigator.share) {
          try { await navigator.share(data); } catch {}
        } else {
          const ok = await copyToClipboard(data.url);
          const orig = btn.textContent;
          btn.textContent = ok ? '✓ Copiado' : '✗ Error';
          setTimeout(() => (btn.textContent = orig), 1400);
        }
      });
    });
  }

  function initPrint() {
    $$('[data-print]').forEach(btn => {
      btn.addEventListener('click', () => window.print());
    });
  }

  function initExternalLinks() {
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

  function initBackTop() {
    let btn = $('.back-top');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'back-top';
      btn.setAttribute('aria-label', 'Volver arriba');
      btn.innerHTML = '↑';
      document.body.appendChild(btn);
    }
    const update = rafThrottle(() => {
      btn.classList.toggle('visible', (window.scrollY || 0) > 500);
    });
    window.addEventListener('scroll', update, { passive: true });
    update();
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
  }

  function initMotionToggle() {
    const btn = $('[data-motion-toggle]');
    if (!btn) return;
    const KEY = 'vn-motion-reduced';
    const stored = window.Utils.storage.get(KEY);
    if (stored === true) document.documentElement.classList.add('force-reduced');
    btn.checked = stored === true;
    btn.addEventListener('change', () => {
      const on = btn.checked;
      document.documentElement.classList.toggle('force-reduced', on);
      window.Utils.storage.set(KEY, on);
    });
  }

  function initThemeToggle() {
    const btn = $('[data-theme-toggle]');
    if (!btn) return;
    const KEY = 'vn-theme';
    const stored = window.Utils.storage.get(KEY);
    if (stored) document.documentElement.setAttribute('data-theme', stored);

    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      window.Utils.storage.set(KEY, next);
    });
  }

  function initStatsTabs() {
    const wrap = $('[data-stats-tabs]');
    if (!wrap) return;
    const tabs = $$('[data-stats-tab]', wrap);
    const panels = $$('[data-stats-panel]', wrap);
    if (!tabs.length || !panels.length) return;

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        panels[i]?.classList.add('active');
      });
    });
    tabs[0]?.click();
  }

  window.IndexPage = {
    initNavToggle,
    initSidebar,
    initActiveNav,
    initSmoothScroll,
    initHashNavigation,
    initLightbox,
    refreshLightboxItems,
    initYear,
    initAnchorCopy,
    initLazyVideos,
    initTOC,
    initQuiz,
    initInteractiveTimeline,
    initShareButtons,
    initPrint,
    initExternalLinks,
    initBackTop,
    initMotionToggle,
    initThemeToggle,
    initStatsTabs,
    initAll() {
      initNavToggle();
      initSidebar();
      initActiveNav();
      initSmoothScroll();
      initLightbox();
      initYear();
      initAnchorCopy();
      initLazyVideos();
      initTOC();
      initQuiz();
      initInteractiveTimeline();
      initShareButtons();
      initPrint();
      initExternalLinks();
      initBackTop();
      initMotionToggle();
      initThemeToggle();
      initStatsTabs();
      setTimeout(initHashNavigation, 100);
    }
  };
})(window, document);