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
    const target = new URL(next, window.location.origin);
    if (!next.startsWith('/') || target.origin !== window.location.origin) return '/admin/';
    return `${target.pathname}${target.search}${target.hash}`;
  }

  const registerForm = document.getElementById('registerForm');
  const registerStatus = document.getElementById('registerStatus');
  function setMode(register) {
    form.hidden = register;
    registerForm.hidden = !register;
    document.getElementById('showLogin').setAttribute('aria-pressed', String(!register));
    document.getElementById('showRegister').setAttribute('aria-pressed', String(register));
    document.getElementById('login-title').textContent = register ? 'Become an author' : 'Editorial sign in';
  }
  document.getElementById('showLogin').addEventListener('click', () => setMode(false));
  document.getElementById('showRegister').addEventListener('click', () => setMode(true));

  async function authPost(path, body) {
    const response = await fetch(`${API}/auth/${path}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      const messages = (payload.error?.details || []).map((item) => item.message);
      throw new Error([payload.error?.message, ...messages].filter(Boolean).join(' — ') || 'Please try again.');
    }
    return payload.data;
  }
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    registerStatus.classList.remove('is-error');
    const password = document.getElementById('registerPassword');
    const confirm = document.getElementById('registerConfirm');
    if (password.value !== confirm.value) {
      registerStatus.classList.add('is-error');
      registerStatus.textContent = 'The passwords do not match.';
      return;
    }
    const button = registerForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const data = await authPost('register', {
        email: document.getElementById('registerEmail').value.trim(), password: password.value,
        display_name: document.getElementById('registerName').value.trim(),
        accepted_terms: document.getElementById('acceptedTerms').checked
      });
      password.value = ''; confirm.value = '';
      registerStatus.textContent = data.email_delivered
        ? 'Application submitted. Check your inbox to verify your email. The owner must approve your application before you can sign in.'
        : 'Application saved. The verification email could not be delivered yet. Try Resend verification email later.';
    } catch (error) {
      registerStatus.classList.add('is-error'); registerStatus.textContent = error.message;
    } finally { button.disabled = false; }
  });
  document.getElementById('resendVerification').addEventListener('click', async (event) => {
    const email = document.getElementById('registerEmail');
    if (!email.reportValidity()) return;
    event.target.disabled = true;
    try {
      const data = await authPost('resend-verification', { email: email.value.trim() });
      registerStatus.classList.remove('is-error'); registerStatus.textContent = data.message;
    } catch (error) {
      registerStatus.classList.add('is-error'); registerStatus.textContent = error.message;
    } finally { event.target.disabled = false; }
  });

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

  // Password visibility toggles (eye icon) — works for login + register fields
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.togglePassword);
      if (!target) return;
      const isPw = target.type === 'password';
      target.type = isPw ? 'text' : 'password';
      btn.setAttribute('aria-label', isPw ? 'Hide password' : 'Show password');
      const icon = btn.querySelector('i');
      if (icon) icon.className = isPw ? 'fas fa-eye-slash' : 'fas fa-eye';
    });
  });

  // Enhance title/subtitle sync for new pro layout
  const subtitle = document.getElementById('auth-subtitle');
  const origSetMode = setMode;
  // wrap to also update subtitle
  const _setMode = (register) => {
    origSetMode(register);
    if (subtitle) subtitle.textContent = register ? 'Create your author application — verified email + owner approval required.' : 'Sign in to open the content dashboard. New here? Apply as an author.';
    document.getElementById('login-title').textContent = register ? 'Create author account' : 'Welcome back';
  };
  // re-bind buttons to new wrapper (keeps existing handlers but adds extra)
  document.getElementById('showLogin').addEventListener('click', () => _setMode(false));
  document.getElementById('showRegister').addEventListener('click', () => _setMode(true));

})();
