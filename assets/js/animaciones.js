(function (window, document) {
  'use strict';

  const U = window.Utils || {};
  const {
    $$, onReady, prefersReducedMotion, clamp, rand,
    debounce, rafThrottle, observeOnce, isTouch
  } = U;

  function initScrollReveal() {
    if (typeof $$ !== 'function') return;
    const els = $$('[data-reveal]');
    if (!els.length) return;

    if (prefersReducedMotion()) {
      els.forEach(el => el.classList.add('is-visible'));
      return;
    }

    observeOnce(els, (el) => {
      const delay = parseInt(el.dataset.revealDelay || '0', 10);
      setTimeout(() => el.classList.add('is-visible'), delay);
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  }

  function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  const EASINGS = { expo: easeOutExpo, cubic: easeOutCubic, linear: t => t };

  function animateCounter(el) {
    const target   = parseFloat(el.dataset.count || '0');
    const duration = parseInt(el.dataset.duration || '1500', 10);
    const prefix   = el.dataset.prefix || '';
    const suffix   = el.dataset.suffix || '';
    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const ease     = EASINGS[el.dataset.easing || 'expo'] || EASINGS.expo;
    const start    = performance.now();

    const format = (v) => prefix + v.toLocaleString('es-ES', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals
    }) + suffix;

    function tick(now) {
      const t = clamp((now - start) / duration, 0, 1);
      el.textContent = format(target * ease(t));
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = format(target);
    }
    requestAnimationFrame(tick);
  }

  function initCounters() {
    if (typeof $$ !== 'function') return;
    const counters = $$('[data-count]');
    if (!counters.length) return;

    if (prefersReducedMotion()) {
      counters.forEach(el => {
        const t = parseFloat(el.dataset.count || '0');
        el.textContent = (el.dataset.prefix || '') +
          t.toLocaleString('es-ES') + (el.dataset.suffix || '');
      });
      return;
    }
    observeOnce(counters, animateCounter, { threshold: 0.4 });
  }

  function initParallax() {
    if (prefersReducedMotion() || isTouch()) return;
    if (typeof $$ !== 'function') return;
    const items = $$('[data-parallax]');
    if (!items.length) return;

    const update = rafThrottle(() => {
      const y = window.scrollY || window.pageYOffset || 0;
      items.forEach(el => {
        const speed = parseFloat(el.dataset.speed || '0.15');
        el.style.transform = `translate3d(0, ${y * speed * -1}px, 0)`;
      });
    });
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  function initTimelineReveal() {
    if (typeof $$ !== 'function') return;
    const items = $$('.tl-item');
    if (!items.length) return;

    if (prefersReducedMotion()) {
      items.forEach(el => el.classList.add('is-visible'));
      return;
    }
    items.forEach(el => el.classList.add('tl-anim'));

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const idx = items.indexOf(entry.target);
          setTimeout(() => entry.target.classList.add('is-visible'), (idx % 3) * 100);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    items.forEach(el => io.observe(el));
  }

  function initProgressBar() {
    if (document.querySelector('.scroll-progress')) return;
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);

    const update = rafThrottle(() => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const pct = h > 0 ? ((window.scrollY || 0) / h) * 100 : 0;
      bar.style.width = clamp(pct, 0, 100) + '%';
    });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  function initHeroEntrance() {
    const hero = document.querySelector('.hero, .creditos-hero');
    if (!hero) return;
    requestAnimationFrame(() => {
      setTimeout(() => hero.classList.add('hero-entered'), 60);
    });
  }

  function initTypewriter() {
    if (typeof $$ !== 'function') return;
    const els = $$('[data-typewriter]');
    if (!els.length || prefersReducedMotion()) return;

    els.forEach(el => {
      let texts = [];
      try { texts = JSON.parse(el.dataset.texts || '[]'); }
      catch { texts = [el.dataset.texts || '']; }
      if (!texts.length) return;

      const speed = parseInt(el.dataset.speed || '60', 10);
      const pause = parseInt(el.dataset.pause || '1600', 10);
      const loop  = el.dataset.loop !== 'false';
      let ti = 0, ci = 0, deleting = false;

      el.textContent = '';
      const caret = document.createElement('span');
      caret.className = 'tw-caret';
      caret.textContent = '|';
      el.after(caret);

      function step() {
        const text = texts[ti];
        if (!deleting) {
          el.textContent = text.slice(0, ++ci);
          if (ci === text.length) {
            if (!loop && ti === texts.length - 1) { caret.remove(); return; }
            deleting = true;
            return setTimeout(step, pause);
          }
        } else {
          el.textContent = text.slice(0, --ci);
          if (ci === 0) { deleting = false; ti = (ti + 1) % texts.length; }
        }
        setTimeout(step, deleting ? speed / 2 : speed);
      }
      step();
    });
  }

  function initLetterReveal() {
    if (typeof $$ !== 'function') return;
    const els = $$('[data-letters]');
    if (!els.length) return;
    if (prefersReducedMotion()) { els.forEach(el => el.classList.add('is-visible')); return; }

    els.forEach(el => {
      const text = el.textContent;
      el.textContent = '';
      el.classList.add('letters');
      [...text].forEach((ch, i) => {
        const span = document.createElement('span');
        span.className = 'letter';
        span.style.transitionDelay = (i * 30) + 'ms';
        span.textContent = ch === ' ' ? '\u00A0' : ch;
        el.appendChild(span);
      });
      observeOnce(el, () => el.classList.add('is-visible'));
    });
  }

  function initTilt() {
    if (prefersReducedMotion() || isTouch()) return;
    if (typeof $$ !== 'function') return;
    const els = $$('[data-tilt]');
    if (!els.length) return;

    els.forEach(el => {
      const max   = parseFloat(el.dataset.tiltMax || '8');
      const persp = parseFloat(el.dataset.tiltPersp || '900');
      el.style.transformStyle = 'preserve-3d';
      el.style.willChange = 'transform';

      const move = (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width  - 0.5;
        const y = (e.clientY - r.top)  / r.height - 0.5;
        el.style.transform = `perspective(${persp}px) rotateY(${x * max}deg) rotateX(${-y * max}deg)`;
      };
      const leave = () => { el.style.transform = ''; };

      el.addEventListener('mousemove', move);
      el.addEventListener('mouseleave', leave);
    });
  }

  function initMagnetic() {
    if (prefersReducedMotion() || isTouch()) return;
    if (typeof $$ !== 'function') return;
    const els = $$('[data-magnetic]');
    if (!els.length) return;

    els.forEach(el => {
      const strength = parseFloat(el.dataset.magneticStrength || '18');
      el.style.transition = 'transform 0.25s cubic-bezier(0.22,1,0.36,1)';

      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
      });
      el.addEventListener('mouseleave', () => { el.style.transform = ''; });
    });
  }

  function initRipple() {
    if (prefersReducedMotion()) return;
    if (typeof $$ !== 'function') return;
    const els = $$('[data-ripple]');
    if (!els.length) return;

    els.forEach(el => {
      el.style.position = el.style.position || 'relative';
      el.style.overflow = 'hidden';
      el.addEventListener('click', (e) => {
        const r = el.getBoundingClientRect();
        const size = Math.max(r.width, r.height);
        const ripple = document.createElement('span');
        ripple.className = 'ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - r.left - size / 2) + 'px';
        ripple.style.top  = (e.clientY - r.top  - size / 2) + 'px';
        el.appendChild(ripple);
        setTimeout(() => ripple.remove(), 650);
      });
    });
  }

  function initLazyImages() {
    if (typeof $$ !== 'function') return;
    const imgs = $$('img[data-src]');
    imgs.forEach(img => {
      img.classList.add('lazy');
      observeOnce(img, () => {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
        if (img.complete) img.classList.add('is-loaded');
      }, { rootMargin: '150px' });
    });

    $$('img').forEach(img => {
      if (img.complete) img.classList.add('is-loaded');
      else img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
    });
  }

  function initParticles() {
    const canvas = document.querySelector('[data-particles]');
    if (!canvas || prefersReducedMotion()) return;

    const ctx = canvas.getContext('2d');
    let w, h, dpr, particles, raf;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.offsetWidth;
      h = canvas.offsetHeight;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function create(n = 40) {
      particles = Array.from({ length: n }, () => ({
        x: rand(0, w), y: rand(0, h),
        vx: rand(-0.15, 0.15), vy: rand(-0.15, 0.15),
        r: rand(0.6, 1.8),
        a: rand(0.15, 0.45)
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(77,208,225,${p.a})`;
        ctx.fill();
      });

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d = Math.hypot(dx, dy);
          if (d < 110) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(77,208,225,${0.08 * (1 - d / 110)})`;
            ctx.lineWidth = 0.6;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }

    function start() { resize(); create(); draw(); }
    function stop()  { cancelAnimationFrame(raf); }

    start();
    window.addEventListener('resize', debounce(() => { stop(); start(); }, 200));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop(); else start();
    });
  }

  function initGlossary() {
    if (typeof $$ !== 'function') return;
    const terms = $$('[data-term]');
    if (!terms.length || !window.GLOSARIO) return;

    const pop = document.createElement('div');
    pop.className = 'glossary-pop';
    pop.setAttribute('role', 'tooltip');
    document.body.appendChild(pop);

    function show(el, text) {
      pop.textContent = text;
      pop.classList.add('visible');
      const r = el.getBoundingClientRect();
      const popR = pop.getBoundingClientRect();
      let left = r.left + r.width / 2 - popR.width / 2;
      let top  = r.top - popR.height - 10 + window.scrollY;
      left = clamp(left, 12, window.innerWidth - popR.width - 12);
      if (top < window.scrollY + 8) {
        top = r.bottom + 10 + window.scrollY;
      }
      pop.style.left = left + 'px';
      pop.style.top  = top + 'px';
    }
    function hide() { pop.classList.remove('visible'); }

    terms.forEach(el => {
      const def = window.GLOSARIO[el.dataset.term];
      if (!def) return;
      el.classList.add('term');
      el.setAttribute('tabindex', '0');
      el.addEventListener('mouseenter', () => show(el, def));
      el.addEventListener('mouseleave', hide);
      el.addEventListener('focus',      () => show(el, def));
      el.addEventListener('blur',       hide);
    });

    window.addEventListener('scroll', hide, { passive: true });
  }

  function initGradientShift() {
    if (prefersReducedMotion()) return;
    if (typeof $$ !== 'function') return;
    $$('[data-gradient-shift]').forEach(el => {
      el.style.backgroundSize = '300% 300%';
      el.style.animation = 'gradientShift 18s ease infinite';
    });
  }

  function initFloat() {
    if (prefersReducedMotion()) return;
    if (typeof $$ !== 'function') return;
    $$('[data-float]').forEach((el, i) => {
      const dur = parseFloat(el.dataset.float || '6');
      el.style.animation = `floaty ${dur}s ease-in-out ${i * 0.4}s infinite`;
    });
  }

  function initSectionProgress() {
    if (prefersReducedMotion()) return;
    if (typeof $$ !== 'function') return;
    const sections = $$('section[id]');
    if (!sections.length) return;

    sections.forEach(sec => {
      const bar = document.createElement('div');
      bar.className = 'section-progress';
      sec.appendChild(bar);
    });

    const update = rafThrottle(() => {
      sections.forEach(sec => {
        const r = sec.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        const progress = total > 0
          ? clamp(-r.top / total, 0, 1)
          : (r.top < 0 ? 1 : 0);
        const bar = sec.querySelector('.section-progress');
        if (bar) bar.style.transform = `scaleY(${progress})`;
      });
    });
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  function initMarquee() {
    if (typeof $$ !== 'function') return;
    $$('[data-marquee]').forEach(el => {
      const text = el.textContent;
      el.innerHTML = '';
      el.classList.add('marquee');
      const inner = document.createElement('div');
      inner.className = 'marquee-inner';
      for (let i = 0; i < 4; i++) {
        const span = document.createElement('span');
        span.textContent = text + '  ·  ';
        inner.appendChild(span);
      }
      el.appendChild(inner);
    });
  }

  function initImgParallax() {
    if (prefersReducedMotion()) return;
    if (typeof $$ !== 'function') return;
    const imgs = $$('[data-img-parallax]');
    if (!imgs.length) return;

    const update = rafThrottle(() => {
      imgs.forEach(img => {
        const r = img.getBoundingClientRect();
        const offset = (r.top + r.height / 2 - window.innerHeight / 2);
        const speed = parseFloat(img.dataset.imgParallax || '0.08');
        img.style.transform = `translateY(${offset * -speed}px) scale(1.08)`;
      });
    });
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  function initAccordions() {
    if (typeof $$ !== 'function') return;
    $$('[data-accordion]').forEach(acc => {
      $$('[data-accordion-item]', acc).forEach(item => {
        const head = item.querySelector('[data-accordion-head]');
        const body = item.querySelector('[data-accordion-body]');
        if (!head || !body) return;

        head.setAttribute('role', 'button');
        head.setAttribute('tabindex', '0');
        head.setAttribute('aria-expanded', 'false');

        const toggle = () => {
          const open = item.classList.toggle('open');
          head.setAttribute('aria-expanded', open ? 'true' : 'false');
          body.style.height = open ? body.scrollHeight + 'px' : '0px';
        };
        head.addEventListener('click', toggle);
        head.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        });
      });
    });
  }

  window.Animaciones = {
    initScrollReveal,
    initCounters,
    initParallax,
    initTimelineReveal,
    initProgressBar,
    initHeroEntrance,
    initTypewriter,
    initLetterReveal,
    initTilt,
    initMagnetic,
    initRipple,
    initLazyImages,
    initParticles,
    initGlossary,
    initGradientShift,
    initFloat,
    initSectionProgress,
    initMarquee,
    initImgParallax,
    initAccordions,
    initAll() {
      initScrollReveal();
      initCounters();
      initParallax();
      initTimelineReveal();
      initProgressBar();
      initHeroEntrance();
      initTypewriter();
      initLetterReveal();
      initTilt();
      initMagnetic();
      initRipple();
      initLazyImages();
      initParticles();
      initGlossary();
      initGradientShift();
      initFloat();
      initSectionProgress();
      initMarquee();
      initImgParallax();
      initAccordions();
    }
  };
})(window, document);