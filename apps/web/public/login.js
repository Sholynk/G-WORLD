// Editorial sign-in for the Sholynk CMS. Posts to /api/v1/auth/login; on
// success the browser holds the session cookie and we continue to ?next=
// (default: the admin dashboard).
(() => {
  const API = '/api/v1';
  const form = document.getElementById('loginForm');
  const status = document.getElementById('loginStatus');
  if (!form || !status) return;

  function nextDestination() {
    const next = new URLSearchParams(window.location.search).get('next') || '/admin/';
    // Only same-origin paths may be used as a redirect target.
    if (!next.startsWith('/') || next.startsWith('//')) return '/admin/';
    return next;
  }

  // Already signed in? Skip the form.
  fetch(`${API}/auth/me`, { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => {
      if (payload?.success && payload?.data?.user) {
        window.location.replace(nextDestination());
      }
    })
    .catch(() => {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.classList.remove('is-error');
    status.textContent = '';

    const button = form.querySelector('button[type="submit"]');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Signing in...';

    try {
      const response = await fetch(`${API}/auth/login`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('email').value.trim(),
          password: document.getElementById('password').value,
          remember: document.getElementById('remember').checked
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        const error = payload.error || {};
        const details = Array.isArray(error.details)
          ? error.details.map((item) => item.message).filter(Boolean)
          : [];
        throw new Error([error.message, ...details].filter(Boolean).join(' - ') || `Sign-in failed (${response.status})`);
      }
      status.textContent = 'Signed in. Opening the dashboard...';
      window.location.href = nextDestination();
    } catch (error) {
      status.classList.add('is-error');
      status.textContent = error.message || 'Sign-in failed. Please try again.';
      button.disabled = false;
      button.innerHTML = original;
    }
  });
})();
