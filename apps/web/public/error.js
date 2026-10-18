// Minimal shared behaviour for the static error pages (403/404/500).
// These documents can be served at any URL depth (Pages answers unmatched
// routes with 404.html while keeping the address bar), so they use
// root-absolute asset paths and deliberately skip the full site script.js,
// whose navigation rewriting assumes a root-level page.
(() => {
  const year = document.getElementById('copyrightYear');
  if (year) year.textContent = String(new Date().getFullYear());
})();
