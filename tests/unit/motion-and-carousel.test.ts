/**
 * Unit tests — the motion helpers and the hero carousel.
 *
 * These two pieces carry the decorative behaviour of the interface, and both
 * have rules that are easy to break by accident:
 *
 *   · the reveal marker has to stay on the element, because the stylesheet
 *     needs it together with the `is-revealed` class to run the animation;
 *   · the carousel has to come back to life after the tab is hidden, and it
 *     has to stay quiet while the pointer is over it.
 *
 * A DOM is provided by happy-dom, and the browser APIs the modules use
 * (IntersectionObserver, matchMedia, requestAnimationFrame) are small
 * stand-ins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';

const PUBLIC = 'apps/web/public';

/** A stand-in for IntersectionObserver that remembers what it observed. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  callback: IntersectionObserverCallback;
  observed = new Set<Element>();
  options: IntersectionObserverInit | undefined;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.add(element);
  }

  unobserve(element: Element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.observed.clear();
  }

  /** Pretends every observed element is on screen. */
  revealAll() {
    const entries = [...this.observed].map(
      (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

let window: Window;
let document: Document;

/** Installs a happy-dom window as the global browser environment. */
function installDom(html = '<!doctype html><html><body></body></html>') {
  window = new Window({ url: 'http://localhost:5173/' });
  document = window.document;
  document.write(html);
  document.close();

  const matchMedia = (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  });

  /*
    The modules reach for the browser APIs through `window`, so the stand-ins
    have to live on the window itself — and the timers have to be the global
    ones, because that is where the fake timers of the test runner live.
  */
  Object.defineProperty(window, 'IntersectionObserver', {
    value: FakeIntersectionObserver,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true });
  Object.defineProperty(window, 'setTimeout', {
    value: (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => globalThis.setTimeout(fn, ms, ...args),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'clearTimeout', {
    value: (handle: number) => globalThis.clearTimeout(handle),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    value: (callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(Date.now()), 0),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    value: (handle: number) => globalThis.clearTimeout(handle),
    configurable: true,
    writable: true,
  });

  const globals: Record<string, unknown> = {
    window,
    document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    MutationObserver: window.MutationObserver,
    IntersectionObserver: FakeIntersectionObserver,
    matchMedia,
    requestAnimationFrame: (callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: number) => globalThis.clearTimeout(handle),
  };

  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  installDom();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('motion helpers', () => {
  it('marks an element as revealed and keeps the marker on it', async () => {
    const { revealOnScroll } = await import(`${PUBLIC}/assets/js/core/motion.js`);

    document.body.innerHTML = '<article data-reveal id="card">Card</article>';
    const card = document.getElementById('card')!;

    revealOnScroll();
    FakeIntersectionObserver.instances[0].revealAll();

    expect(card.classList.contains('is-revealed')).toBe(true);
    // The stylesheet matches `[data-reveal].is-revealed`, so the marker must
    // survive — removing it would leave the element without its animation.
    expect(card.hasAttribute('data-reveal')).toBe(true);
  });

  it('reveals everything at once when the visitor asked for less motion', async () => {
    const { prefersReducedMotion, revealOnScroll } = await import(`${PUBLIC}/assets/js/core/motion.js`);

    const reduced = (query: string) => ({
      matches: query.includes('reduced-motion'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    });

    Object.defineProperty(window, 'matchMedia', { value: reduced, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'matchMedia', { value: reduced, configurable: true, writable: true });

    expect(prefersReducedMotion()).toBe(true);

    document.body.innerHTML = '<article data-reveal id="card">Card</article>';
    const card = document.getElementById('card')!;

    revealOnScroll();
    expect(card.classList.contains('is-revealed')).toBe(true);
  });

  it('counts a number up to its value', async () => {
    const { countUp } = await import(`${PUBLIC}/assets/js/core/motion.js`);

    document.body.innerHTML = '<span id="number">0</span>';
    const node = document.getElementById('number')!;

    countUp(node, 12, { duration: 0 });
    expect(node.textContent).toBe('12');
  });
});

describe('hero carousel', () => {
  const markup = `<!doctype html><html><body>
    <section data-hero-slider>
      <article data-hero-slide class="hero__slide is-active"></article>
      <article data-hero-slide class="hero__slide"></article>
      <article data-hero-slide class="hero__slide"></article>
      <button data-hero-prev></button>
      <button data-hero-next></button>
      <button data-hero-dot="0" class="hero__dot is-active"></button>
      <button data-hero-dot="1" class="hero__dot"></button>
      <button data-hero-dot="2" class="hero__dot"></button>
      <button data-hero-toggle>Pause</button>
      <span data-hero-progress-bar></span>
    </section>
  </body></html>`;

  it('rotates to the next slide after five seconds', async () => {
    installDom(markup);
    vi.useFakeTimers();

    const { createCarousel, SLIDE_DURATION } = await import(`${PUBLIC}/assets/js/components/carousel.js`);
    expect(SLIDE_DURATION).toBe(5000);

    const root = document.querySelector('[data-hero-slider]') as HTMLElement;
    createCarousel({ root, duration: SLIDE_DURATION });

    const slides = [...document.querySelectorAll('[data-hero-slide]')];
    expect(slides[0].classList.contains('is-active')).toBe(true);

    vi.advanceTimersByTime(SLIDE_DURATION);
    expect(slides[1].classList.contains('is-active')).toBe(true);
    expect(slides[0].hasAttribute('aria-hidden')).toBe(true);

    vi.advanceTimersByTime(SLIDE_DURATION);
    expect(slides[2].classList.contains('is-active')).toBe(true);

    // It wraps around.
    vi.advanceTimersByTime(SLIDE_DURATION);
    expect(slides[0].classList.contains('is-active')).toBe(true);
  });

  it('stops while the pointer is over it and starts again afterwards', async () => {
    installDom(markup);
    vi.useFakeTimers();

    const { createCarousel } = await import(`${PUBLIC}/assets/js/components/carousel.js`);
    const root = document.querySelector('[data-hero-slider]') as HTMLElement;
    createCarousel({ root, duration: 5000 });

    const slides = [...document.querySelectorAll('[data-hero-slide]')];

    root.dispatchEvent(new window.MouseEvent('mouseenter'));
    vi.advanceTimersByTime(15000);
    expect(slides[0].classList.contains('is-active')).toBe(true);

    root.dispatchEvent(new window.MouseEvent('mouseleave'));
    vi.advanceTimersByTime(5000);
    expect(slides[1].classList.contains('is-active')).toBe(true);
  });

  it('comes back to life when the tab is shown again', async () => {
    installDom(markup);
    vi.useFakeTimers();

    const { createCarousel } = await import(`${PUBLIC}/assets/js/components/carousel.js`);
    const root = document.querySelector('[data-hero-slider]') as HTMLElement;
    createCarousel({ root, duration: 5000 });

    const slides = [...document.querySelectorAll('[data-hero-slide]')];

    // The tab is hidden: the carousel must stop.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    vi.advanceTimersByTime(15000);
    expect(slides[0].classList.contains('is-active')).toBe(true);

    // The tab comes back: the carousel must not stay dead.
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    vi.advanceTimersByTime(5000);
    expect(slides[1].classList.contains('is-active')).toBe(true);
  });

  it('can be paused by the visitor', async () => {
    installDom(markup);
    vi.useFakeTimers();

    const { createCarousel } = await import(`${PUBLIC}/assets/js/components/carousel.js`);
    const root = document.querySelector('[data-hero-slider]') as HTMLElement;
    createCarousel({ root, duration: 5000 });

    const slides = [...document.querySelectorAll('[data-hero-slide]')];
    const toggle = document.querySelector('[data-hero-toggle]') as HTMLButtonElement;

    toggle.dispatchEvent(new window.MouseEvent('click'));
    expect(toggle.textContent).toBe('Play');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    vi.advanceTimersByTime(15000);
    expect(slides[0].classList.contains('is-active')).toBe(true);
  });

  it('moves with the arrow keys and the dots', async () => {
    installDom(markup);
    vi.useFakeTimers();

    const { createCarousel } = await import(`${PUBLIC}/assets/js/components/carousel.js`);
    const root = document.querySelector('[data-hero-slider]') as HTMLElement;
    createCarousel({ root, duration: 5000 });

    const slides = [...document.querySelectorAll('[data-hero-slide]')];

    root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(slides[1].classList.contains('is-active')).toBe(true);

    root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(slides[0].classList.contains('is-active')).toBe(true);

    (document.querySelector('[data-hero-dot="2"]') as HTMLElement).dispatchEvent(
      new window.MouseEvent('click'),
    );
    expect(slides[2].classList.contains('is-active')).toBe(true);
  });
});
