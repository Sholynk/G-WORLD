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
 * Elements that arrive later — the cards of a list that was just loaded, for
 * instance — are picked up by a mutation observer, so a page can call this
 * once and still animate everything it renders.
 *
 * @param {ParentNode} [root] where to look for the elements
 */
export function revealOnScroll(root = document) {
  /*
    The marker stays on the element: the stylesheet uses it together with the
    `is-revealed` class to run the animation, and the animation keeps the
    element in place when it ends. Removing the marker here would take the
    element out of the animation entirely.
  */
  const show = (element) => {
    element.classList.add('is-revealed');
  };

  if (prefersReducedMotion() || !window.IntersectionObserver) {
    for (const element of root.querySelectorAll('[data-reveal]')) show(element);
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

  const observe = (element) => {
    if (!element?.matches?.('[data-reveal]')) return;
    if (element.classList.contains('is-revealed')) return;
    observer.observe(element);
  };

  for (const element of root.querySelectorAll('[data-reveal]')) observe(element);

  // Watch for elements that are added after this call.
  if (root === document && window.MutationObserver && document.body) {
    const mutations = new window.MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!node?.matches) continue;
          observe(node);
          for (const child of node.querySelectorAll?.('[data-reveal]') ?? []) observe(child);
        }
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true });
  }
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
 * Counts up every number marked with `data-count`.
 *
 * A number that is already on screen when the page is ready counts up. A
 * number that is still below the fold keeps its final value — a figure that
 * reads "0" until the visitor scrolls to it is worse than no animation at all.
 *
 * @param {ParentNode} [root]
 */
export function countUpOnScroll(root = document) {
  const targets = [...root.querySelectorAll('[data-count]')];
  if (!targets.length) return;

  const decimalsOf = (element) => Number(element.dataset.countDecimals ?? 0);

  const run = (element) => {
    const value = Number(element.getAttribute('data-count') ?? 0);
    countUp(element, value, { decimals: decimalsOf(element) });
  };

  const show = (element) => {
    const value = Number(element.getAttribute('data-count') ?? 0);
    element.textContent =
      decimalsOf(element) > 0 ? value.toFixed(decimalsOf(element)) : Math.round(value).toLocaleString('en-US');
  };

  if (prefersReducedMotion() || !window.IntersectionObserver) {
    for (const element of targets) run(element);
    return;
  }

  const height = window.innerHeight || 800;

  for (const element of targets) {
    // Already on screen? Count it up now. Below the fold? Keep the real
    // number — a figure that reads "0" until the visitor scrolls to it is
    // worse than no animation at all.
    const box = element.getBoundingClientRect?.();
    if (box && box.top < height && box.bottom > 0) run(element);
    else show(element);
  }
}
