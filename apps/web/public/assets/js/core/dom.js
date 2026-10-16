/**
 * Core — DOM helpers.
 *
 * Small, boring functions used by every page module. Two rules matter here:
 *   1. `text()` always assigns through `textContent`, so untrusted strings can
 *      never become markup.
 *   2. `html()` is only ever passed output the *server* rendered (for example a
 *      lesson's `content_html`, which `lib/text.ts` builds after escaping), and
 *      says so in its name so reviewers can grep for it.
 */

export const qs = (selector, scope = document) => scope.querySelector(selector);
export const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Creates an element.
 *
 * @param {string} tag
 * @param {object} [options]
 * @param {string} [options.class]
 * @param {string} [options.text]      assigned via textContent
 * @param {string} [options.html]      trusted, server-rendered HTML only
 * @param {object} [options.attrs]     attribute map (skipped when null/undefined)
 * @param {object} [options.data]      dataset entries
 * @param {Array<Node|string|null>} [options.children]
 * @param {object} [options.on]        event name → handler
 */
/**
 * Creates an element.
 *
 * `el(tag, { class, text, attrs, on, children })` is the main form: an options
 * object keeps call sites readable and self-documenting. A third argument is
 * accepted as a shorthand for `children`, because writing a list of nodes at the
 * end of a call is the natural thing to do — and silently dropping it (which is
 * what happened to the data tables) is exactly the kind of bug that only shows
 * up as an empty table on screen.
 *
 * @param {string} tag
 * @param {object} [options]
 * @param {Array<Node|string|null>|Node|string} [children]
 */
export function el(tag, options = {}, children = null) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.html !== undefined) node.innerHTML = options.html;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const [name, value] of Object.entries(options.data ?? {})) {
    if (value === null || value === undefined) continue;
    node.dataset[name] = String(value);
  }
  for (const [event, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(event, handler);
  }
  const shorthand = children === null || children === undefined ? [] : Array.isArray(children) ? children : [children];
  for (const child of [...(options.children ?? []), ...shorthand]) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replaces the contents of a container. */
export function render(target, ...children) {
  const node = typeof target === 'string' ? qs(target) : target;
  if (!node) return null;
  node.replaceChildren(...children.flat().filter(Boolean));
  return node;
}

export function clear(target) {
  const node = typeof target === 'string' ? qs(target) : target;
  if (node) node.replaceChildren();
  return node;
}

export function show(target) {
  const node = typeof target === 'string' ? qs(target) : target;
  if (node) node.hidden = false;
  return node;
}

export function hide(target) {
  const node = typeof target === 'string' ? qs(target) : target;
  if (node) node.hidden = true;
  return node;
}

/**
 * Reads `?key=` from the query string. `allowed` narrows the value to a known
 * set so a crafted URL cannot put arbitrary text into the page.
 */
export function queryParam(key, fallback = null, allowed = null) {
  const value = new URLSearchParams(window.location.search).get(key);
  if (value === null) return fallback;
  if (allowed && !allowed.includes(value)) return fallback;
  return value;
}

/** Delegated click handling: `on(root, '[data-action="x"]', handler)`. */
export function delegate(root, selector, event, handler) {
  const node = typeof root === 'string' ? qs(root) : root;
  if (!node) return () => {};
  const listener = (domEvent) => {
    const match = domEvent.target.closest?.(selector);
    if (match && node.contains(match)) handler(domEvent, match);
  };
  node.addEventListener(event, listener);
  return () => node.removeEventListener(event, listener);
}

/** Debounces a function (used by the catalog search box). */
export function debounce(fn, delay = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Reads a form into a plain object (trimmed strings, checkboxes as booleans). */
export function formValues(form) {
  const values = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (value instanceof File) continue;
    if (key.endsWith('[]')) {
      const name = key.slice(0, -2);
      values[name] = [...(values[name] ?? []), value];
      continue;
    }
    values[key] = typeof value === 'string' ? value.trim() : value;
  }
  for (const input of form.querySelectorAll('input[type="checkbox"][name]')) {
    // Checkbox *groups* share a `[]`-suffixed name and were already collected as
    // an array above; only single named checkboxes are read as booleans.
    if (input.name.endsWith('[]')) continue;
    values[input.name] = input.checked;
  }
  return values;
}

/** Applies field-level errors from an ApiError to the matching inputs. */
export function showFieldErrors(form, fieldErrors) {
  clearFieldErrors(form);
  let firstOffender = null;
  for (const [field, messages] of fieldErrors) {
    const input = form.elements.namedItem(field);
    const message = messages[0] ?? 'This value is not valid.';
    if (input && 'setCustomValidity' in input) {
      input.setCustomValidity(message);
      input.setAttribute('aria-invalid', 'true');
      const wrapper = input.closest('.field') ?? input.parentElement;
      if (wrapper && !wrapper.querySelector('.field-error')) {
        wrapper.append(el('p', { class: 'field-error', text: message }));
      }
      firstOffender ??= input;
    }
  }
  firstOffender?.focus();
  return Boolean(firstOffender);
}

export function clearFieldErrors(form) {
  for (const input of form.querySelectorAll('[aria-invalid]')) {
    input.removeAttribute('aria-invalid');
    input.setCustomValidity?.('');
  }
  for (const node of form.querySelectorAll('.field-error')) node.remove();
}

/** Formats an ISO timestamp for `<time datetime>`. */
export function timeElement(iso, formatter) {
  const date = new Date(iso);
  return el('time', {
    attrs: { datetime: iso, title: date.toISOString() },
    text: formatter ? formatter(date) : date.toLocaleDateString(),
  });
}
