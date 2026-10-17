/**
 * Components — hero carousel.
 *
 * A small, dependency-free slider:
 *
 *   · it rotates every five seconds and shows a progress line while a slide
 *     is on screen;
 *   · it pauses on hover, on keyboard focus and when the tab is in the
 *     background — an auto-rotating carousel must never steal the keyboard;
 *   · it can be paused and started again by the visitor;
 *   · it answers to the left and right arrow keys;
 *   · it works with a swipe on a touch screen.
 *
 * The slides are written in the HTML, so the first one is readable before
 * this module runs. The module only takes over the behaviour.
 */
import { qsa } from '../core/dom.js';
import { prefersReducedMotion } from '../core/motion.js';

/** How long a slide stays on screen. */
export const SLIDE_DURATION = 5000;

/**
 * @param {object} options
 * @param {HTMLElement} options.root the slider element
 * @param {number} [options.duration] milliseconds per slide
 * @returns {{goTo: (index: number) => void, next: () => void, previous: () => void, destroy: () => void}|null}
 */
export function createCarousel({ root, duration = SLIDE_DURATION } = {}) {
  if (!root) return null;

  const slides = qsa('[data-hero-slide]', root);
  if (slides.length < 2) return null;

  const dots = qsa('[data-hero-dot]', root);
  const visuals = qsa('[data-hero-visual-item]', root);
  const progressBar = root.querySelector('[data-hero-progress-bar]');
  const toggle = root.querySelector('[data-hero-toggle]');

  let index = 0;
  let timer = null;
  let raf = null;
  let startedAt = 0;
  let stopped = false;
  let userPaused = prefersReducedMotion();

  const paint = () => {
    slides.forEach((slide, position) => {
      const active = position === index;
      slide.classList.toggle('is-active', active);
      if (active) slide.removeAttribute('aria-hidden');
      else slide.setAttribute('aria-hidden', 'true');
    });

    visuals.forEach((visual, position) => {
      const active = position === index;
      visual.classList.toggle('is-active', active);
      if (active) visual.removeAttribute('aria-hidden');
      else visual.setAttribute('aria-hidden', 'true');
    });

    dots.forEach((dot, position) => {
      const active = position === index;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-current', active ? 'true' : 'false');
    });

    if (toggle) {
      toggle.textContent = userPaused ? 'Play' : 'Pause';
      toggle.setAttribute('aria-pressed', userPaused ? 'true' : 'false');
    }
  };

  const goTo = (target, { restart = true } = {}) => {
    index = (target + slides.length) % slides.length;
    paint();
    if (restart) start();
  };

  const next = () => goTo(index + 1);
  const previous = () => goTo(index - 1);

  /* ------------------------------------------------------- the auto timer */

  const stopTimer = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
    if (raf) window.cancelAnimationFrame(raf);
    raf = null;
  };

  const tick = (now) => {
    if (!progressBar) return;
    const elapsed = now - startedAt;
    const ratio = Math.min(1, elapsed / duration);
    progressBar.style.width = `${ratio * 100}%`;
    if (ratio < 1) raf = window.requestAnimationFrame(tick);
  };

  const start = () => {
    stopTimer();
    if (userPaused) {
      if (progressBar) progressBar.style.width = '0%';
      return;
    }
    startedAt = performance.now();
    if (progressBar) {
      progressBar.style.width = '0%';
      raf = window.requestAnimationFrame(tick);
    }
    timer = window.setTimeout(() => {
      index = (index + 1) % slides.length;
      paint();
      start();
    }, duration);
  };

  const pause = () => {
    stopped = true;
    stopTimer();
  };

  const resume = () => {
    stopped = false;
    start();
  };

  /* ------------------------------------------------------------- controls */

  root.querySelector('[data-hero-next]')?.addEventListener('click', next);
  root.querySelector('[data-hero-prev]')?.addEventListener('click', previous);

  dots.forEach((dot, position) => {
    dot.addEventListener('click', () => goTo(position));
  });

  toggle?.addEventListener('click', () => {
    userPaused = !userPaused;
    paint();
    if (userPaused) stopTimer();
    else start();
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    }
  });

  // Hovering or focusing the slider pauses the rotation.
  root.addEventListener('mouseenter', pause);
  root.addEventListener('mouseleave', resume);
  root.addEventListener('focusin', pause);
  root.addEventListener('focusout', (event) => {
    if (!root.contains(event.relatedTarget)) resume();
  });

  // A backgrounded tab must not keep the carousel running.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else if (!stopped) resume();
  });

  /* --------------------------------------------------------------- swipe */

  let touchStart = null;
  root.addEventListener(
    'touchstart',
    (event) => {
      touchStart = event.changedTouches?.[0]?.clientX ?? null;
    },
    { passive: true },
  );
  root.addEventListener(
    'touchend',
    (event) => {
      if (touchStart === null) return;
      const end = event.changedTouches?.[0]?.clientX ?? touchStart;
      const distance = end - touchStart;
      touchStart = null;
      if (Math.abs(distance) < 48) return;
      if (distance < 0) next();
      else previous();
    },
    { passive: true },
  );

  paint();
  start();

  return {
    goTo,
    next,
    previous,
    destroy() {
      stopTimer();
    },
  };
}
