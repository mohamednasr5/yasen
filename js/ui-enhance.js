/* ══════════════════════════════════════════════════════════════════
   UI ENHANCE — طبقة حركات إضافية فقط (لا تلمس أي منطق أو بيانات)
   يضيف: تأثير التموج على الأزرار + عداد متحرك للأرقام والإحصائيات
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Ripple effect on any .btn click ── */
  function attachRipple(el) {
    if (el.dataset.rippleBound) return;
    el.dataset.rippleBound = '1';
    el.addEventListener('click', function (e) {
      const rect = el.getBoundingClientRect();
      const ripple = document.createElement('span');
      const size = Math.max(rect.width, rect.height) * 1.4;
      ripple.style.position = 'absolute';
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      ripple.style.borderRadius = '50%';
      ripple.style.background = 'rgba(255,255,255,0.35)';
      ripple.style.pointerEvents = 'none';
      ripple.style.transform = 'scale(0)';
      ripple.style.opacity = '0.6';
      ripple.style.transition = 'transform 0.55s cubic-bezier(0.22,1,0.36,1), opacity 0.55s ease';
      ripple.style.zIndex = '0';
      el.appendChild(ripple);
      requestAnimationFrame(() => {
        ripple.style.transform = 'scale(1)';
        ripple.style.opacity = '0';
      });
      setTimeout(() => ripple.remove(), 600);
    });
  }

  function scanButtons(root) {
    (root || document).querySelectorAll('.btn, .nav-item, .bn-item, .bs-item, .tab').forEach((el) => {
      el.style.position = el.style.position || 'relative';
      el.style.overflow = el.style.overflow || 'hidden';
      attachRipple(el);
    });
  }

  /* ── Animated count-up whenever a stat value's text changes ── */
  function parseNumeric(str) {
    if (!str) return null;
    const match = String(str).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
  }

  function animateValue(el, from, to, suffix) {
    const duration = 550;
    const start = performance.now();
    const decimals = (String(to).split('.')[1] || '').length;
    function step(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const current = from + (to - from) * eased;
      el.textContent = current.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function watchCounters() {
    const targets = document.querySelectorAll('.stat-value, .ticker-val, .summary-item .val');
    const seen = new WeakMap();

    const obs = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        const el = m.target.nodeType === 3 ? m.target.parentElement : m.target;
        if (!el || !el.matches || !el.matches('.stat-value, .summary-item .val')) return;
        const text = el.textContent;
        const num = parseNumeric(text);
        if (num === null) return;
        const prev = seen.get(el);
        if (prev !== undefined && prev !== num && !el.dataset.animating) {
          const suffix = text.replace(/^[^\d]*-?[\d,.]+/, '');
          el.dataset.animating = '1';
          animateValue(el, prev, num, suffix);
          setTimeout(() => { delete el.dataset.animating; }, 600);
        }
        seen.set(el, num);
      });
    });

    targets.forEach((el) => {
      const num = parseNumeric(el.textContent);
      if (num !== null) seen.set(el, num);
      obs.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  /* ── Sidebar / nav-item entrance stagger already handled via CSS ── */

  /* ── Init + keep re-scanning as the app renders dynamic content ── */
  function init() {
    scanButtons(document);
    watchCounters();

    const globalObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 1) scanButtons(node);
        });
      }
    });
    globalObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
