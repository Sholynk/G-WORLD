/**
 * Core — motion.
 *
 * Small helpers for the decorative motion of the interface:
 *
 *   · `prefersReducedMotion()` — the single place that asks the browser
 *     whether the visitor asked for less motion;
 *   · `revealOnScroll()` — fades elements marked with `data-reveal` in as they
 *     enter the viewport;
 *   · `countUp()` — animates a number from zero to its value.
 *
 * Everything here degrades quietly: without `IntersectionObserver` the
 * elements are simply shown, and with reduced motion the numbers appear at
 * their final value straight away.
 */

/** @returns {boolean} true when the visitor asked for reduced motion. */
export function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

/**
 * Fades the elements marked with `data-reveal` in as they scroll into view.
 *
 * The elements are hidden by CSS only when JavaScript is running (the `js`
 * class on <html>), so a page without JavaScript still shows everything.
 *
 * @param {ParentNode} [root] where to look for the elements
 */
export function revealOnScroll(root = document) {
  const targets = [...root.querySelectorAll('[data-reveal]')];
  if (!targets.length) return;

  const show = (element) => {
    element.classList.add('is-revealed');
    element.removeAttribute('data-reveal');
  };

  if (prefersReducedMotion() || !window.IntersectionObserver) {
    for (const element of targets) show(element);
    return;
  }

  const observer = new window.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        show(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );

  for (const element of targets) observer.observe(element);
}

/**
 * Counts a number up to its value.
 *
 * @param {HTMLElement} element the element whose text is the number
 * @param {number} value the number to count to
 * @param {object} [options]
 * @param {number} [options.duration] milliseconds
 * @param {number} [options.decimals] digits after the point
 */
export function countUp(element, value, options = {}) {
  const { duration = 900, decimals = 0 } = options;
  const target = Number(value);
  if (!Number.isFinite(target)) return;

  const format = (number) =>
    decimals > 0
      ? number.toFixed(decimals)
      : Math.round(number).toLocaleString('en-US');

  if (prefersReducedMotion() || duration <= 0) {
    element.textContent = format(target);
    return;
  }

  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    // easeOutExpo — fast at first, then settling on the final number.
    const eased = progress === 1 ? 1 : 1 - 2 ** (-10 * progress);
    element.textContent = format(target * eased);
    if (progress < 1) window.requestAnimationFrame(step);
  };

  window.requestAnimationFrame(step);
}

/**
 * Counts up every number marked with `data-count` once it is on screen.
 *
 * @param {ParentNode} [root]
 */
export function countUpOnScroll(root = document) {
  const targets = [...root.querySelectorAll('[data-count]')];
  if (!targets.length) return;

  const run = (element) => {
    const value = Number(element.getAttribute('data-count') ?? 0);
    countUp(element, value, { decimals: Number(element.dataset.countDecimals ?? 0) });
  };

  if (prefersReducedMotion() || !window.IntersectionObserver) {
    for (const element of targets) run(element);
    return;
  }

  const observer = new window.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        run(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.4 },
  );

  for (const element of targets) observer.observe(element);
}
