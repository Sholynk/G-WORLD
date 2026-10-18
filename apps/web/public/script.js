// Shared enhancements for Sholynk pages: accessible navigation, current year, and small UX fixes.
(() => {
  const pageLinks = {
    home: 'index.html',
    technology: 'index.html?category=Technology',
    ai: 'index.html?category=AI%20Trends',
    cryptocurrency: 'index.html?category=Cryptocurrency',
    'web 3': 'index.html?category=Web%203',
    game: 'index.html?category=Game',
    about: 'about.html',
    contact: 'contact.html',
    'help & support': 'help_&_support.html',
    'privacy policy': 'privacy_policy.html'
  };

  const normalizeText = (text = '') => text.trim().replace(/\s+/g, ' ').toLowerCase();

  // Root pages use `index.html`, while clean runtime article routes are two
  // path segments deeper and use `../../index.html`. Derive the public-site
  // prefix from the logo link so shared scripts preserve nested-page links.
  function getSitePrefix() {
    const homeHref = document
      .querySelector('header a[aria-label="Sholynk homepage"]')
      ?.getAttribute('href') || 'index.html';
    const pathOnly = homeHref.split(/[?#]/, 1)[0];
    return /index\.html$/i.test(pathOnly)
      ? pathOnly.replace(/index\.html$/i, '')
      : '';
  }

  function resolveSitePath(target) {
    return `${getSitePrefix()}${target}`;
  }

  function comparablePathname(pathname) {
    const decoded = decodeURIComponent(pathname || '/');
    return decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  }

  function setCopyrightYear() {
    const year = document.getElementById('copyrightYear');
    if (year) year.textContent = new Date().getFullYear().toString();
  }

  function addSkipLink() {
    if (document.querySelector('.skip-link')) return;
    const skipLink = document.createElement('a');
    skipLink.className = 'skip-link';
    skipLink.href = '#main-content';
    skipLink.textContent = 'Skip to main content';
    document.body.prepend(skipLink);

    const main = document.querySelector('main') || document.querySelector('body > section');
    if (main && !main.id) main.id = 'main-content';
    if (main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  }

  function normalizeNavigationLinks() {
    const currentPath = comparablePathname(window.location.pathname);
    const currentCategory = new URLSearchParams(window.location.search).get('category');

    document.querySelectorAll('header nav a, .sidebar a, footer a').forEach((link) => {
      // Pages keep a baseline active state in the HTML, but the
      // runtime URL is the source of truth. Clear it first so category URLs like
      // index.html?category=AI%20Trends do not leave Home highlighted too.
      link.classList.remove('is-active');
      link.removeAttribute('aria-current');
      link.closest('li')?.classList.remove('highlighted');

      const label = normalizeText(link.textContent);
      if (pageLinks[label]) {
        link.setAttribute('href', resolveSitePath(pageLinks[label]));
        link.removeAttribute('target');
        link.removeAttribute('rel');
      }

      const href = link.getAttribute('href') || '';
      if (!href || href.startsWith('#')) return;

      let target;
      try {
        target = new URL(href, window.location.href);
      } catch (error) {
        return;
      }

      const linkCategory = target.searchParams.get('category');
      const isCurrentPage = comparablePathname(target.pathname) === currentPath;
      const isCurrentCategory = isCurrentPage
        && linkCategory
        && currentCategory
        && linkCategory.toLowerCase() === currentCategory.toLowerCase();
      const isIndexPage = /\/index\.html$/i.test(target.pathname);
      const isHome = isIndexPage && !linkCategory;
      const homeWithoutCategory = isCurrentPage && isHome && !currentCategory;
      const active = isCurrentCategory || homeWithoutCategory || (isCurrentPage && !isIndexPage);

      if (active) {
        link.setAttribute('aria-current', 'page');
        link.classList.add('is-active');
        link.closest('li')?.classList.add('highlighted');
      }
    });
  }

  function enhanceSidebar() {
    const sidebar = document.getElementById('sidebar');
    const hamburger = document.querySelector('.hamburger');
    if (!sidebar || !hamburger) return;

    const desktopQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 901px)')
      : { matches: false, addEventListener() { }, addListener() { } };

    sidebar.setAttribute('aria-label', 'Mobile navigation');
    sidebar.setAttribute('aria-hidden', 'true');
    sidebar.inert = true;

    if (!document.querySelector('.sidebar-close')) {
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'sidebar-close';
      closeButton.setAttribute('aria-label', 'Close navigation menu');
      closeButton.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
      sidebar.prepend(closeButton);
    }

    let backdrop = document.querySelector('.sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('button');
      backdrop.type = 'button';
      backdrop.className = 'sidebar-backdrop';
      backdrop.setAttribute('aria-label', 'Close navigation menu');
      document.body.append(backdrop);
    }

    hamburger.removeAttribute('onclick');
    if (hamburger.tagName !== 'BUTTON') {
      hamburger.setAttribute('role', 'button');
      hamburger.setAttribute('tabindex', '0');
    }
    hamburger.setAttribute('aria-label', 'Open navigation menu');
    hamburger.setAttribute('aria-controls', 'sidebar');
    hamburger.setAttribute('aria-expanded', 'false');

    const focusableSelector = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

    window.openSidebar = () => {
      // The off-canvas sidebar is a mobile-only affordance.
      if (desktopQuery.matches) return;
      sidebar.inert = false;
      sidebar.classList.add('active');
      backdrop.classList.add('is-visible');
      document.body.classList.add('sidebar-open');
      sidebar.setAttribute('aria-hidden', 'false');
      hamburger.setAttribute('aria-expanded', 'true');
      sidebar.querySelector(focusableSelector)?.focus({ preventScroll: true });
    };

    window.closeSidebar = () => {
      if (sidebar.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      sidebar.inert = true;
      sidebar.classList.remove('active');
      backdrop.classList.remove('is-visible');
      document.body.classList.remove('sidebar-open');
      sidebar.setAttribute('aria-hidden', 'true');
      hamburger.setAttribute('aria-expanded', 'false');
    };

    window.toggleSidebar = () => {
      if (sidebar.classList.contains('active')) {
        window.closeSidebar();
      } else {
        window.openSidebar();
      }
    };

    const handleDesktopChange = (event) => {
      if (event.matches) window.closeSidebar();
    };
    if (typeof desktopQuery.addEventListener === 'function') {
      desktopQuery.addEventListener('change', handleDesktopChange);
    } else {
      desktopQuery.addListener(handleDesktopChange);
    }

    hamburger.addEventListener('click', window.toggleSidebar);
    hamburger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        window.toggleSidebar();
      }
    });

    sidebar.querySelector('.sidebar-close')?.addEventListener('click', window.closeSidebar);
    backdrop.addEventListener('click', window.closeSidebar);

    sidebar.addEventListener('click', (event) => {
      const link = event.target.closest('a');
      if (link) window.closeSidebar();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sidebar.classList.contains('active')) {
        window.closeSidebar();
        hamburger.focus({ preventScroll: true });
      }
    });
  }

  function enhanceNewsletterForms() {
    document.querySelectorAll('form[name="subscribe"]').forEach((form) => {
      if (form.dataset.enhanced === 'true') return;
      form.dataset.enhanced = 'true';

      const status = document.createElement('p');
      status.className = 'form-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      form.append(status);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const originalLabel = button?.textContent || 'Subscribe';
        if (button) {
          button.disabled = true;
          button.textContent = 'Subscribing...';
        }
        status.classList.remove('is-error');
        status.textContent = '';

        try {
          const response = await fetch(form.action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(new FormData(form)).toString()
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `Subscription failed (${response.status})`);
          form.reset();
          status.textContent = payload?.data?.message || payload?.message || 'Thank you for subscribing.';
        } catch (error) {
          status.classList.add('is-error');
          status.textContent = error.message || 'Subscription failed. Please try again.';
        } finally {
          if (button) {
            button.disabled = false;
            button.textContent = originalLabel;
          }
        }
      });
    });
  }

  function addScrollToTop() {
    if (document.querySelector('.scroll-to-top')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scroll-to-top';
    button.setAttribute('aria-label', 'Scroll to top');
    button.innerHTML = '<i class="fas fa-arrow-up" aria-hidden="true"></i>';
    document.body.append(button);

    const toggleVisibility = () => {
      if (window.scrollY > 400) {
        button.classList.add('is-visible');
      } else {
        button.classList.remove('is-visible');
      }
    };

    button.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          toggleVisibility();
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });

    toggleVisibility();
  }

  function addAutoHideHeader() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    // Direction-aware auto-hiding:
    //   scrolling DOWN slides the navbar up off-screen — and it stays hidden
    //   while the reader keeps moving down; scrolling back UP (even a little)
    //   brings it back; and reaching the page top always restores it.
    const showHeader = () => header.classList.remove('is-hidden');
    const hideHeader = () => header.classList.add('is-hidden');

    const HIDE_OFFSET = 80; // px from the top before the header may hide at all
    const MIN_DELTA = 6; // px of movement required before reacting (jitter guard)

    let lastScrollY = Math.max(window.scrollY, 0);

    const update = () => {
      const currentScrollY = Math.max(window.scrollY, 0); // ignore iOS bounce above 0

      // At (or near) the page top the navbar is always visible. It also never
      // hides while the mobile navigation is open, so its close control stays
      // reachable.
      if (currentScrollY <= HIDE_OFFSET || document.body.classList.contains('sidebar-open')) {
        showHeader();
        lastScrollY = currentScrollY;
        return;
      }

      const delta = currentScrollY - lastScrollY;
      if (Math.abs(delta) <= MIN_DELTA) return; // tiny trackpad jitters: keep current state
      lastScrollY = currentScrollY;

      if (delta > 0) hideHeader(); // heading down: tuck the navbar away
      else showHeader(); // heading up: the reader wants navigation back
    };

    let ticking = false;
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          window.requestAnimationFrame(() => {
            update();
            ticking = false;
          });
          ticking = true;
        }
      },
      { passive: true }
    );

    // Keyboard users tabbing into the header must see it, and opening the
    // mobile menu should always reveal its trigger.
    header.addEventListener('focusin', showHeader);

    update();
  }

  function init() {
    addSkipLink();
    setCopyrightYear();
    normalizeNavigationLinks();
    enhanceSidebar();
    enhanceNewsletterForms();
    addScrollToTop();
    addAutoHideHeader();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
