/**
 * Browser client for the live Sholynk API.
 *
 * Mutable content is never read from checked-in JSON: every read goes to the
 * D1-backed API through the same-origin `/api/v1` proxy. If the application or
 * database is unavailable, callers receive an error and can show an explicit
 * service-unavailable state instead of stale content.
 *
 * Responses use the platform envelope `{ success, data, meta }` /
 * `{ success: false, error: { code, message, details } }`.
 *
 * Signed-in editorial sessions carry an httpOnly cookie plus a readable CSRF
 * cookie (`sk_csrf`); unsafe requests echo it in the `X-CSRF-Token` header so
 * a cross-site page cannot drive an authenticated browser.
 */
window.SholynkCMS = (() => {
  const API_BASE = window.SHOLYNK_CONFIG?.apiBaseUrl || '/api/v1';
  let availability = null;
  let availabilityPromise = null;

  function siteRoot() {
    return new URL('/', window.location.href).href;
  }

  function resolvePath(value) {
    const raw = String(value || '');
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/')) return new URL(raw, siteRoot()).href;
    return new URL(raw.replace(/^\/+/, ''), siteRoot()).href;
  }

  function readCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  async function parseResponse(response) {
    const type = response.headers?.get?.('content-type') || '';
    if (type.includes('application/json')) return response.json();
    const text = await response.text();
    return text ? { data: text } : {};
  }

  /** Builds one human-readable message from the error envelope. */
  function errorMessage(payload, status) {
    const error = payload?.error;
    if (!error) return `Request failed (${status})`;
    if (typeof error === 'string') return error;
    const details = Array.isArray(error.details)
      ? error.details.map((detail) => detail?.message).filter(Boolean)
      : [];
    return [error.message, ...details].filter(Boolean).join(' - ') || `Request failed (${status})`;
  }

  async function apiRequest(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const method = String(options.method || 'GET').toUpperCase();
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (options.body && !isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (UNSAFE_METHODS.has(method) && !headers['X-CSRF-Token']) {
      const csrf = readCookie('sk_csrf');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const response = await fetch(resolvePath(`${API_BASE}${path}`), {
      credentials: 'same-origin',
      ...options,
      method,
      headers
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      const error = new Error(errorMessage(payload, response.status));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function isApiAvailable() {
    if (availability !== null) return availability;
    if (!availabilityPromise) {
      availabilityPromise = fetch(resolvePath(`${API_BASE}/health`), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      })
        .then(async (response) => {
          if (!response.ok) return false;
          const payload = await response.json();
          return payload.success === true;
        })
        .catch(() => false)
        .then((available) => {
          availability = available;
          availabilityPromise = null;
          return available;
        });
    }
    return availabilityPromise;
  }

  function refreshApiAvailability() {
    availability = null;
    availabilityPromise = null;
  }

  function normalize(article) {
    if (!article) return article;
    const slug = article.slug || String(article.id || '');
    return {
      ...article,
      slug,
      link: article.externalLink || article.cleanLink || `articles/${encodeURIComponent(slug)}/`,
      cleanLink: article.externalLink || `articles/${encodeURIComponent(slug)}/`
    };
  }

  async function requireApi() {
    if (await isApiAvailable()) return;
    throw new Error('The content service is unavailable. Please try again shortly.');
  }

  async function getArticles({ category, q, status = 'published', limit, offset, hero } = {}) {
    await requireApi();
    const params = new URLSearchParams();
    if (category && category !== 'All') params.set('category', category);
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (Number.isFinite(limit)) params.set('limit', String(limit));
    if (Number.isFinite(offset)) params.set('offset', String(offset));
    if (hero === true) params.set('hero', 'true');
    const payload = await apiRequest(`/articles${params.size ? `?${params}` : ''}`);
    return (payload.data || []).map(normalize);
  }

  async function getArticle(slug) {
    await requireApi();
    try {
      const payload = await apiRequest(`/articles/${encodeURIComponent(slug)}`);
      return normalize(payload.data);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function getAuthors() {
    await requireApi();
    const payload = await apiRequest('/authors');
    return payload.data || [];
  }

  async function getSettings() {
    await requireApi();
    const payload = await apiRequest('/settings');
    return payload.data || {};
  }

  return {
    apiRequest,
    errorMessage,
    isApiAvailable,
    refreshApiAvailability,
    getArticles,
    getArticle,
    getAuthors,
    getSettings,
    resolvePath
  };
})();
