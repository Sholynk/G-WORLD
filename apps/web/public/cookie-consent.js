/**
 * Sholynk cookie consent.
 *
 * Sets a real, first-party cookie (`sholynk_consent`) recording the reader's
 * choice, plus a small preferences cookie (`sholynk_consent_prefs`) recording
 * which optional categories they allowed. Essential cookies (the ones the
 * site needs to function — navigation state, the anonymous engagement
 * "voter id" used by the reactions/comments widgets) are always on and are
 * never gated by this banner.
 *
 * Categories:
 *  - essential   always on, not shown as a toggle.
 *  - functional  remembers on-site preferences (e.g. reopening this banner).
 *  - analytics   would gate any future visit/usage analytics.
 *
 * No consent, no cookie other than the consent record itself: nothing here
 * sets a functional/analytics cookie until the reader opts in.
 */
window.SholynkConsent = (() => {
  const COOKIE_NAME = 'sholynk_consent';
  const PREFS_COOKIE_NAME = 'sholynk_consent_prefs';
  const COOKIE_MAX_AGE_DAYS = 180;

  function setCookie(name, value, days) {
    const maxAge = Math.round(days * 24 * 60 * 60);
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function readPrefs() {
    try {
      return JSON.parse(getCookie(PREFS_COOKIE_NAME) || '{}');
    } catch (error) {
      return {};
    }
  }

  function saveChoice(choice, prefs) {
    setCookie(COOKIE_NAME, choice, COOKIE_MAX_AGE_DAYS);
    setCookie(PREFS_COOKIE_NAME, JSON.stringify(prefs), COOKIE_MAX_AGE_DAYS);
  }

  function hasChoice() {
    return Boolean(getCookie(COOKIE_NAME));
  }

  function resolveSitePath(target) {
    const homeHref = document
      .querySelector('header a[aria-label="Sholynk homepage"]')
      ?.getAttribute('href') || 'index.html';
    const pathOnly = homeHref.split(/[?#]/, 1)[0];
    const prefix = /index\.html$/i.test(pathOnly)
      ? pathOnly.replace(/index\.html$/i, '')
      : '';
    return `${prefix}${target}`;
  }

  function buildBanner() {
    const banner = document.createElement('div');
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.hidden = true;

    banner.innerHTML = `
      <div class="cookie-banner-card">
        <div class="cookie-banner-main">
          <p class="cookie-banner-title"><i class="fas fa-cookie-bite" aria-hidden="true"></i> We use cookies</p>
          <p class="cookie-banner-text">
            Sholynk uses essential cookies to keep the site running, plus optional cookies to remember
            your preferences. You can accept everything, decline the optional ones, or choose exactly
            what to allow. Read our <a href="${resolveSitePath('privacy_policy.html')}">Privacy Policy</a> for details.
          </p>
          <div class="cookie-banner-prefs" id="cookiePrefsPanel" hidden>
            <label class="cookie-pref-row cookie-pref-locked">
              <span>
                <strong>Essential</strong>
                <small>Required for navigation and core features. Always on.</small>
              </span>
              <input type="checkbox" checked disabled aria-label="Essential cookies (always on)"/>
            </label>
            <label class="cookie-pref-row">
              <span>
                <strong>Functional</strong>
                <small>Remembers preferences like this banner's choice and on-site settings.</small>
              </span>
              <input type="checkbox" id="cookiePrefFunctional" aria-label="Allow functional cookies"/>
            </label>
            <label class="cookie-pref-row">
              <span>
                <strong>Analytics</strong>
                <small>Helps us understand which articles are useful, in aggregate.</small>
              </span>
              <input type="checkbox" id="cookiePrefAnalytics" aria-label="Allow analytics cookies"/>
            </label>
          </div>
        </div>
        <div class="cookie-banner-actions">
          <button type="button" class="cookie-btn cookie-btn-ghost" id="cookieManageBtn">Manage preferences</button>
          <button type="button" class="cookie-btn cookie-btn-outline" id="cookieDeclineBtn">Decline optional</button>
          <button type="button" class="cookie-btn cookie-btn-outline" id="cookieSaveBtn" hidden>Save preferences</button>
          <button type="button" class="cookie-btn cookie-btn-primary" id="cookieAcceptBtn">Accept all</button>
        </div>
      </div>
    `;

    document.body.append(banner);
    return banner;
  }

  function show(banner, { manage = false } = {}) {
    const prefs = readPrefs();
    const functionalInput = banner.querySelector('#cookiePrefFunctional');
    const analyticsInput = banner.querySelector('#cookiePrefAnalytics');
    functionalInput.checked = Boolean(prefs.functional);
    analyticsInput.checked = Boolean(prefs.analytics);

    banner.hidden = false;
    banner.querySelector('#cookiePrefsPanel').hidden = !manage;
    banner.querySelector('#cookieSaveBtn').hidden = !manage;
    banner.querySelector('#cookieManageBtn').hidden = manage;
    requestAnimationFrame(() => banner.classList.add('is-visible'));
  }

  function hide(banner) {
    banner.classList.remove('is-visible');
    window.setTimeout(() => {
      banner.hidden = true;
    }, 220);
  }

  function init() {
    const banner = buildBanner();

    const openManageBtn = document.getElementById('cookieSettingsBtn');

    if (!hasChoice()) {
      show(banner, { manage: false });
    }

    banner.querySelector('#cookieAcceptBtn').addEventListener('click', () => {
      saveChoice('accepted', { functional: true, analytics: true });
      hide(banner);
    });

    banner.querySelector('#cookieDeclineBtn').addEventListener('click', () => {
      saveChoice('declined', { functional: false, analytics: false });
      hide(banner);
    });

    banner.querySelector('#cookieManageBtn').addEventListener('click', () => {
      banner.querySelector('#cookiePrefsPanel').hidden = false;
      banner.querySelector('#cookieManageBtn').hidden = true;
      banner.querySelector('#cookieSaveBtn').hidden = false;
    });

    banner.querySelector('#cookieSaveBtn').addEventListener('click', () => {
      const functional = banner.querySelector('#cookiePrefFunctional').checked;
      const analytics = banner.querySelector('#cookiePrefAnalytics').checked;
      saveChoice('custom', { functional, analytics });
      hide(banner);
    });

    if (openManageBtn) {
      openManageBtn.addEventListener('click', () => {
        show(banner, { manage: true });
      });
    }

    // The privacy policy page links directly into "manage" mode too.
    const inlineManageBtn = document.getElementById('privacyManageCookiesBtn');
    if (inlineManageBtn) {
      inlineManageBtn.addEventListener('click', () => {
        show(banner, { manage: true });
      });
    }

    return { show: (options) => show(banner, options), hide: () => hide(banner) };
  }

  return {
    init,
    getChoice: () => getCookie(COOKIE_NAME),
    getPreferences: readPrefs
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.SholynkConsent.init());
} else {
  window.SholynkConsent.init();
}
