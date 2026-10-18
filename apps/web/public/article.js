// Progressive enhancements for article HTML rendered from the live database.
(() => {
  const root = document.getElementById('articleRoot');
  if (!root) return;

  function enhanceExternalLinks(articleRoot) {
    articleRoot.querySelectorAll('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      if (/^https?:\/\//i.test(href)) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }
    });
  }

  function initReadingProgress() {
    const bar = document.getElementById('readingProgressBar');
    if (!bar || bar.dataset.enhanced === 'true') return;
    bar.dataset.enhanced = 'true';
    let ticking = false;
    const update = () => {
      const articleTop = root.getBoundingClientRect().top + window.scrollY;
      const articleEnd = articleTop + root.offsetHeight - window.innerHeight;
      const distance = Math.max(articleEnd - articleTop, 1);
      const ratio = Math.max(0, Math.min(1, (window.scrollY - articleTop) / distance));
      bar.style.width = `${ratio * 100}%`;
      ticking = false;
    };
    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      (window.requestAnimationFrame || window.setTimeout)(update);
    };
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    update();
  }

  function fallbackCopy(value) {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    textarea.remove();
    return copied;
  }

  function initCopyButton(articleRoot) {
    articleRoot.querySelectorAll('[data-copy-article]').forEach((button) => {
      if (button.dataset.enhanced === 'true') return;
      button.dataset.enhanced = 'true';
      button.addEventListener('click', async () => {
        const reference = button.dataset.copyUrl
          || document.querySelector('link[rel="canonical"]')?.href
          || window.location.href;
        const value = new URL(reference, window.location.href).href;
        const status = button.closest('.article-share')?.querySelector('.article-share-status');
        let copied = false;
        try {
          copied = navigator.clipboard?.writeText
            ? await navigator.clipboard.writeText(value).then(() => true)
            : fallbackCopy(value);
        } catch (error) {
          copied = fallbackCopy(value);
        }
        if (status) {
          status.textContent = copied
            ? 'Link copied to your clipboard.'
            : 'Select and copy the address from your browser.';
        }
        const label = button.querySelector('span');
        const original = label?.textContent;
        if (label && copied) {
          label.textContent = 'Copied';
          window.setTimeout(() => { label.textContent = original; }, 1800);
        }
      });
    });
  }

  function headingOffset(element) {
    const declared = typeof window.getComputedStyle === 'function'
      ? parseFloat(window.getComputedStyle(element).scrollMarginTop)
      : NaN;
    if (Number.isFinite(declared) && declared > 0) return declared;
    const header = document.querySelector('.site-header');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    return Math.round((Number.isFinite(headerHeight) ? headerHeight : 0) + 16);
  }

  function desiredScrollTop(element) {
    const top = element.getBoundingClientRect().top + window.scrollY - headingOffset(element);
    const documentHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0
    );
    const target = Math.max(0, top);
    if (documentHeight <= window.innerHeight) return target;
    return Math.min(target, documentHeight - window.innerHeight);
  }

  function scrollWindowTo(top, smooth) {
    try {
      window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    } catch (error) {
      window.scrollTo(0, top);
    }
  }

  function scrollHeadingIntoView(heading, { smooth = true } = {}) {
    if (typeof heading.scrollIntoView === 'function') {
      heading.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    } else {
      scrollWindowTo(desiredScrollTop(heading), smooth);
    }
    if (typeof window.scrollTo !== 'function') return;

    let cancelled = false;
    const cancel = () => { cancelled = true; };
    const userEvents = ['wheel', 'touchstart', 'keydown', 'mousedown'];
    userEvents.forEach((type) => window.addEventListener(type, cancel, { passive: true, once: true }));
    const deadline = Date.now() + 1600;
    const settle = () => {
      if (cancelled) return;
      const desired = desiredScrollTop(heading);
      if (Math.abs(desired - window.scrollY) > 2) scrollWindowTo(desired, false);
      if (Date.now() < deadline) window.setTimeout(settle, 120);
      else userEvents.forEach((type) => window.removeEventListener(type, cancel));
    };
    window.setTimeout(settle, smooth ? 420 : 60);
  }

  function initToc(articleRoot) {
    const toc = articleRoot.querySelector('.article-toc');
    if (!toc || toc.dataset.enhanced === 'true') return;
    toc.dataset.enhanced = 'true';

    const compact = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 920px)')
      : null;
    if (compact?.matches) toc.open = false;
    compact?.addEventListener?.('change', (event) => { toc.open = !event.matches; });

    const links = [...toc.querySelectorAll('a[href^="#"]')];
    const headingLinks = new Map();
    links.forEach((link) => {
      const id = decodeURIComponent(link.getAttribute('href').slice(1));
      const heading = document.getElementById(id);
      if (!heading) return;
      headingLinks.set(heading, link);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (compact?.matches) toc.open = false;
        scrollHeadingIntoView(heading, { smooth: !reducedMotion });
        try {
          window.history.pushState(null, '', `#${encodeURIComponent(id)}`);
        } catch (error) {
          window.location.hash = id;
        }
        window.setTimeout(() => heading.focus({ preventScroll: true }), reducedMotion ? 0 : 350);
        links.forEach((item) => item.removeAttribute('aria-current'));
        link.setAttribute('aria-current', 'location');
      });
    });

    const settleHash = () => {
      const id = decodeURIComponent((window.location.hash || '').slice(1));
      const heading = id ? document.getElementById(id) : null;
      if (!heading || !headingLinks.has(heading)) return;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      scrollHeadingIntoView(heading, { smooth: !reducedMotion });
      links.forEach((item) => item.removeAttribute('aria-current'));
      headingLinks.get(heading).setAttribute('aria-current', 'location');
    };
    if (window.location.hash) window.setTimeout(settleHash, 0);
    window.addEventListener('hashchange', settleHash);

    if ('IntersectionObserver' in window && headingLinks.size) {
      const observer = new IntersectionObserver((entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible) return;
        links.forEach((link) => link.removeAttribute('aria-current'));
        headingLinks.get(visible.target)?.setAttribute('aria-current', 'location');
      }, { rootMargin: '-15% 0px -70% 0px' });
      headingLinks.forEach((link, heading) => observer.observe(heading));
    }
  }

  function enhanceShareLinks(articleRoot) {
    const share = articleRoot.querySelector('.article-share');
    if (!share) return;
    const reference = share.querySelector('[data-copy-article]')?.dataset.copyUrl
      || document.querySelector('link[rel="canonical"]')?.href
      || window.location.href;
    const canonical = new URL(reference, window.location.href).href;
    const title = articleRoot.querySelector('h1')?.textContent?.trim() || document.title;
    const destinations = {
      'Share on X': `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${title} ${canonical}`)}`,
      'Share on Facebook': `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonical)}`,
      'Share on WhatsApp': `https://wa.me/?text=${encodeURIComponent(`${title} ${canonical}`)}`
    };
    for (const [label, href] of Object.entries(destinations)) {
      share.querySelector(`a[aria-label="${label}"]`)?.setAttribute('href', href);
    }
  }

  function init() {
    if (root.dataset.serverRendered !== 'true') {
      root.setAttribute('aria-busy', 'false');
      root.innerHTML = '<div class="empty-state"><h3>Article unavailable</h3><p>This page must be served by the Sholynk application.</p><a class="article-back" href="/">Back to homepage</a></div>';
      return;
    }
    enhanceExternalLinks(root);
    enhanceShareLinks(root);
    initCopyButton(root);
    initToc(root);
    initReadingProgress();
    const slug = root.dataset.slug;
    const engagementRoot = document.getElementById('engagementRoot');
    if (engagementRoot && slug) window.SholynkEngagement?.mount(engagementRoot, { slug });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
