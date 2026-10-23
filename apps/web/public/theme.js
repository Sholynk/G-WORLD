/**
 * Sholynk — universal theme manager (light / dark)
 * Persists to localStorage (sholynk-theme), respects prefers-color-scheme,
 * syncs across tabs, exposes toggle UI on every page.
 * Design: X black + X blue #1D9BF0 accent, smooth transitions.
 */
(() => {
  const STORAGE_KEY = 'sholynk-theme';
  const ATTR = 'data-theme';

  function getPreferred() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {}
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch {}
    return 'light';
  }

  function applyTheme(theme) {
    const t = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute(ATTR, t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
    // Keep meta theme-color in sync (affects mobile chrome)
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', t === 'dark' ? '#000000' : '#ffffff');
    // Update toggle icons
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      const isDark = t === 'dark';
      btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('title', isDark ? 'Light mode' : 'Dark mode');
      btn.setAttribute('aria-pressed', String(isDark));
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
      }
    });
    // Dispatch custom event for other scripts
    window.dispatchEvent(new CustomEvent('sholynk:themechange', { detail: { theme: t } }));
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute(ATTR) || getPreferred();
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // Early apply (also inline script in <head> does this; this is fallback)
  if (!document.documentElement.hasAttribute(ATTR)) {
    applyTheme(getPreferred());
  } else {
    // ensure toggle icons reflect early value
    applyTheme(document.documentElement.getAttribute(ATTR));
  }

  // Create toggle button if not present
  function ensureToggle() {
    // Search for existing toggle
    if (document.querySelector('[data-theme-toggle]')) return;

    const headerInner = document.querySelector('.site-header-inner') || document.querySelector('.admin-header');
    if (!headerInner) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.setAttribute('data-theme-toggle', '');
    btn.setAttribute('aria-label', 'Toggle theme');
    btn.setAttribute('title', 'Toggle theme');
    // For admin header, different placement
    if (headerInner.classList.contains('admin-header')) {
      // admin has .header-actions — insert before View site link
      const actions = headerInner.querySelector('.header-actions');
      if (actions) {
        btn.classList.add('ghost-button', 'theme-toggle--admin');
        btn.innerHTML = '<i class="fas fa-moon" aria-hidden="true"></i>';
        actions.prepend(btn);
      } else {
        headerInner.appendChild(btn);
      }
    } else {
      // public site: insert after nav, before hamburger
      const hamburger = headerInner.querySelector('.hamburger');
      const nav = headerInner.querySelector('.site-nav');
      btn.innerHTML = '<i class="fas fa-moon" aria-hidden="true"></i>';
      if (hamburger) {
        headerInner.insertBefore(btn, hamburger);
      } else if (nav) {
        nav.after(btn);
      } else {
        headerInner.appendChild(btn);
      }
    }
    btn.addEventListener('click', toggleTheme);

    // Also add to sidebar for mobile (duplicate toggle there)
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.querySelector('[data-theme-toggle]')) {
      const sideBtn = btn.cloneNode(true);
      sideBtn.classList.add('theme-toggle--sidebar');
      sideBtn.addEventListener('click', toggleTheme);
      // place at top after h3
      const h3 = sidebar.querySelector('h3');
      if (h3) h3.after(sideBtn);
      else sidebar.prepend(sideBtn);
    }
  }

  // Expose globally
  window.__sholynkTheme = { apply: applyTheme, toggle: toggleTheme, get: () => document.documentElement.getAttribute(ATTR) };

  document.addEventListener('DOMContentLoaded', () => {
    ensureToggle();
    // initial icon sync
    applyTheme(document.documentElement.getAttribute(ATTR) || getPreferred());

    // bind any existing toggles (including those injected via HTML)
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      if (btn._themeBound) return;
      btn._themeBound = true;
      btn.addEventListener('click', toggleTheme);
    });
  });

  // Also try immediately in case header already exists (e.g., admin)
  if (document.readyState !== 'loading') {
    ensureToggle();
  }

  // Cross-tab sync
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
      applyTheme(e.newValue);
    }
  });

  // Listen for system preference changes when no explicit choice stored
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', (e) => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== 'light' && stored !== 'dark') {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      } catch {}
    });
  } catch {}

  // Keyboard shortcut: Ctrl/Cmd + Shift + T
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      toggleTheme();
    }
  });
})();
