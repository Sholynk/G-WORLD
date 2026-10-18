// Account recovery: forgot-password, reset-password (?token=…) and email
// verification (?verify=…) in one page. All three talk to /api/v1/auth/*.
(() => {
  const API = '/api/v1';
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const verifyToken = params.get('verify');

  const cards = {
    forgot: document.getElementById('forgotCard'),
    reset: document.getElementById('resetCard'),
    verify: document.getElementById('verifyCard')
  };

  function show(which) {
    Object.entries(cards).forEach(([name, card]) => {
      if (card) card.hidden = name !== which;
    });
  }

  async function post(path, body) {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      const error = payload.error || {};
      const details = Array.isArray(error.details)
        ? error.details.map((item) => item.message).filter(Boolean)
        : [];
      throw new Error(
        [typeof error === 'string' ? error : error.message, ...details].filter(Boolean).join(' - ')
        || `Request failed (${response.status})`
      );
    }
    return payload.data || {};
  }

  /* ------------------------------ verify mode ------------------------------ */
  if (verifyToken) {
    show('verify');
    const status = document.getElementById('verifyStatus');
    post('/auth/verify-email', { token: verifyToken })
      .then(() => {
        status.classList.remove('is-error');
        status.textContent = 'Email confirmed. Your account is active — you can sign in now.';
        document.getElementById('verify-title').textContent = 'Email confirmed';
        window.setTimeout(() => { window.location.href = '/login.html'; }, 1800);
      })
      .catch((error) => {
        status.classList.add('is-error');
        status.textContent = error.message;
        document.getElementById('verify-title').textContent = 'This link did not work';
      });
    return;
  }

  /* ------------------------------- reset mode ------------------------------ */
  if (token) {
    show('reset');
    const form = document.getElementById('resetForm');
    const status = document.getElementById('resetStatus');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      status.classList.remove('is-error');
      const password = document.getElementById('newPassword').value;
      const confirm = document.getElementById('confirmPassword').value;
      if (password !== confirm) {
        status.classList.add('is-error');
        status.textContent = 'The two passwords do not match.';
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await post('/auth/reset-password', { token, password });
        status.textContent = 'Password updated. Redirecting to sign in...';
        window.setTimeout(() => { window.location.href = '/login.html'; }, 1500);
      } catch (error) {
        status.classList.add('is-error');
        status.textContent = error.message;
        button.disabled = false;
      }
    });
    return;
  }

  /* ------------------------------ forgot mode ------------------------------ */
  show('forgot');
  const form = document.getElementById('forgotForm');
  const status = document.getElementById('forgotStatus');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.classList.remove('is-error');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = await post('/auth/forgot-password', {
        email: document.getElementById('forgotEmail').value.trim()
      });
      status.textContent = data.message || 'If an account exists for that address, a reset link is on its way.';
    } catch (error) {
      status.classList.add('is-error');
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
})();
