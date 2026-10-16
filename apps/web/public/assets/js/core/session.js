/**
 * Core — session state.
 *
 * The browser never decodes a token: the session lives in an HttpOnly cookie
 * that JavaScript deliberately cannot read, and the truth about "who am I" comes
 * from `GET /api/v1/me`. This module caches that answer briefly so a page with
 * several components does not issue six identical requests, and notifies
 * subscribers when the answer changes (sign-in, sign-out, revocation).
 */
import { config } from './config.js';
import { api } from './api.js';

/** @typedef {{ user: object, permissions: string[], stats: object, unread_notifications: number }} Session */

let cache = null; // { value: Session|null, at: number }
let pending = null; // in-flight request, so concurrent calls share one fetch
const listeners = new Set();

/** Resolves the current session, or null for a visitor. */
export async function getSession({ force = false } = {}) {
  const fresh = cache && Date.now() - cache.at < config.sessionCacheMs;
  if (fresh && !force) return cache.value;
  if (pending && !force) return pending;

  pending = api
    .get('/me')
    .then((data) => {
      cache = { value: data, at: Date.now() };
      return data;
    })
    .catch((error) => {
      // A visitor is a normal state, not an error: 401 simply means "no session".
      if (error?.isAuthError) {
        cache = { value: null, at: Date.now() };
        return null;
      }
      throw error;
    })
    .finally(() => {
      pending = null;
    });

  const value = await pending;
  return value;
}

export function clearSessionCache() {
  cache = null;
}

/** Subscribes to session changes; returns an unsubscribe function. */
export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(value) {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      console.error('[session] listener failed', error);
    }
  }
}

export async function signIn({ email, password, remember = false }) {
  const data = await api.post('/auth/login', { email, password, remember });
  clearSessionCache();
  const session = await getSession({ force: true });
  announce(session);
  return { ...data, session };
}

export async function signOut() {
  try {
    await api.post('/auth/logout', {});
  } finally {
    clearSessionCache();
    announce(null);
  }
}

export function isSignedIn(session) {
  return Boolean(session?.user);
}

export function hasPermission(session, permission) {
  return Boolean(session?.permissions?.includes(permission));
}

export function isStaff(session) {
  return hasPermission(session, 'course.write') || hasPermission(session, 'course.read.any');
}

export function isAdmin(session) {
  return session?.user?.role === 'admin' || session?.user?.role === 'super_admin';
}

/**
 * Redirects to the sign-in page when there is no session, remembering where the
 * user was headed. Returns the session when there is one.
 */
export async function requireSession({ redirect = true } = {}) {
  const session = await getSession();
  if (session) return session;
  if (redirect) {
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.assign(`/login.html?next=${next}`);
  }
  return null;
}

/** Reads `?next=` safely: only same-site paths are honoured. */
export function nextPath(fallback = '/dashboard.html') {
  const raw = new URLSearchParams(window.location.search).get('next');
  if (!raw) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}
