(function (window, document) {
  'use strict';

  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const $id = (id) => document.getElementById(id);

  function createEl(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else el.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function on(el, evt, handler, opts) {
    if (!el) return () => {};
    el.addEventListener(evt, handler, opts);
    return () => el.removeEventListener(evt, handler, opts);
  }

  function delegate(root, selector, evt, handler) {
    if (!root) return () => {};
    const fn = (e) => {
      const target = e.target.closest(selector);
      if (target && root.contains(target)) handler.call(target, e, target);
    };
    root.addEventListener(evt, fn);
    return () => root.removeEventListener(evt, fn);
  }

  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function debounce(fn, wait = 150) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function throttle(fn, limit = 100) {
    let lastCall = 0;
    let timer = null;
    let lastArgs = null;
    let lastThis = null;
    return function (...args) {
      const now = Date.now();
      const remaining = limit - (now - lastCall);
      lastArgs = args;
      lastThis = this;
      if (remaining <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        lastCall = now;
        fn.apply(lastThis, lastArgs);
      } else if (!timer) {
        timer = setTimeout(() => {
          lastCall = Date.now();
          timer = null;
          fn.apply(lastThis, lastArgs);
        }, remaining);
      }
    };
  }

  function rafThrottle(fn) {
    let scheduled = false;
    return function (...args) {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        fn.apply(this, args);
        scheduled = false;
      });
    };
  }

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const clamp   = (n, min, max) => Math.min(Math.max(n, min), max);
  const lerp    = (a, b, t) => a + (b - a) * t;
  const rand    = (min, max) => Math.random() * (max - min) + min;
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const mq = (q) => window.matchMedia(q);
  const prefersReducedMotion = () => mq('(prefers-reduced-motion: reduce)').matches;
  const prefersDark          = () => mq('(prefers-color-scheme: dark)').matches;
  const isTouch              = () => mq('(hover: none)').matches || 'ontouchstart' in window;

  function scrollToEl(target, offset = 80) {
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    const top = el.getBoundingClientRect().top + (window.scrollY || 0) - offset;
    window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function getScrollProgress() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    return h > 0 ? clamp((window.scrollY || 0) / h, 0, 1) : 0;
  }

  function isInViewport(el, threshold = 0) {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight * (1 - threshold) &&
           r.bottom > window.innerHeight * threshold;
  }

  function lockScroll() {
    const sw = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (sw > 0) document.body.style.paddingRight = sw + 'px';
  }
  function unlockScroll() {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || '';
  }
  function slugify(str) {
    return String(str)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  function truncate(str, n = 80, ell = '…') {
    return str.length > n ? str.slice(0, n - ell.length) + ell : str;
  }
  function formatNumber(n, locale = 'es-ES') {
    return new Intl.NumberFormat(locale).format(n);
  }

  const storage = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch {} },
    clear() {
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith('vn-'))
          .forEach(k => localStorage.removeItem(k));
      } catch {}
    }
  };

  function createEventBus() {
    const map = new Map();
    return {
      on(evt, fn) {
        if (!map.has(evt)) map.set(evt, new Set());
        map.get(evt).add(fn);
        return () => map.get(evt)?.delete(fn);
      },
      off(evt, fn) { map.get(evt)?.delete(fn); },
      emit(evt, payload) {
        map.get(evt)?.forEach(fn => {
          try { fn(payload); } catch (e) { console.error('[bus]', evt, e); }
        });
      },
      clear() { map.clear(); }
    };
  }
  const bus = createEventBus();

  function observeOnce(targets, callback, opts = {}) {
    const list = Array.isArray(targets) ? targets : [targets];
    if (!('IntersectionObserver' in window)) {
      list.forEach(t => callback(t, true));
      return () => {};
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          callback(e.target, e);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px', ...opts });
    list.forEach(t => io.observe(t));
    return () => io.disconnect();
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  function urlParam(name) {
    return new URLSearchParams(location.search).get(name);
  }
  function pageName() {
    const path = window.location.pathname.split('/').pop() || 'index.html';
    return path.replace('.html', '') || 'index';
  }
  function isExternal(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin !== location.origin;
    } catch { return false; }
  }

  function preloadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
  async function preloadImages(srcs) {
    return Promise.allSettled(srcs.map(preloadImage));
  }

  function formatDate(d, locale = 'es-ES') {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit', month: 'long', year: 'numeric'
    }).format(d instanceof Date ? d : new Date(d));
  }

  window.Utils = {
    $, $$, $id,
    createEl, on, delegate,
    onReady,
    debounce, throttle, rafThrottle, wait,
    clamp, lerp, rand, randInt, shuffle,
    mq, prefersReducedMotion, prefersDark, isTouch,
    scrollToEl, getScrollProgress, isInViewport, lockScroll, unlockScroll,
    escapeHtml, stripHtml, slugify, truncate, formatNumber,
    storage, bus, observeOnce,
    copyToClipboard,
    urlParam, pageName, isExternal,
    preloadImage, preloadImages,
    formatDate
  };
})(window, document);