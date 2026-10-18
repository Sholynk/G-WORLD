// Account recovery: forgot-password, reset-password (?token=…) and email
// verification (?verify=…) in one page. All three talk to /api/v1/auth/*.
(() => {
  const API = '/api/v1';
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const verifyToken = params.get('verify');
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  let ownerToken = fragment.get('owner-setup') || fragment.get('owner-code');
  const recoveringCode = fragment.has('owner-code');
  if (ownerToken) window.history.replaceState(null, '', window.location.pathname + window.location.search);

  const cards = {
    forgot: document.getElementById('forgotCard'),
    reset: document.getElementById('resetCard'),
    verify: document.getElementById('verifyCard'),
    owner: document.getElementById('ownerSecurityCard'),
    ownerRequest: document.getElementById('ownerRequestCard')
  };

  function show(which) {
    Object.entries(cards).forEach(([name, card]) => {
      if (card) card.hidden = name !== which;
    });
  }

  async function post(path, body) {
    const csrfMatch = document.cookie.match(/(?:^|; )sk_csrf=([^;]*)/);
    const headers = { 'Content-Type': 'application/json' };
    if (csrfMatch) headers['X-CSRF-Token'] = decodeURIComponent(csrfMatch[1]);
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
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

  if (ownerToken) {
    show('owner');
    const form = document.getElementById('ownerSecurityForm');
    const status = document.getElementById('ownerSecurityStatus');
    const password = document.getElementById('ownerPassword');
    const confirmPassword = document.getElementById('ownerPasswordConfirm');
    if (recoveringCode) {
      document.getElementById('owner-security-title').textContent = 'Reset your confirmation code';
      document.getElementById('ownerSecurityDescription').textContent = 'Stay signed in as the owner, enter your current login password, and choose a new separate code. If you are signed out, sign in and then reopen the email link. All sessions will be signed out after completion.';
      document.getElementById('ownerPasswordLabel').textContent = 'Current login password';
      password.autocomplete = 'current-password'; password.minLength = 1;
      document.getElementById('ownerPasswordConfirmField').hidden = true;
      confirmPassword.required = false;
      document.getElementById('ownerSecuritySubmit').textContent = 'Reset confirmation code';
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = document.getElementById('ownerCode');
      const confirmCode = document.getElementById('ownerCodeConfirm');
      status.classList.remove('is-error');
      if ((!recoveringCode && password.value !== confirmPassword.value) || code.value !== confirmCode.value) {
        status.classList.add('is-error'); status.textContent = 'The repeated password or confirmation code does not match.'; return;
      }
      if (password.value.normalize('NFKC') === code.value.normalize('NFKC')) {
        status.classList.add('is-error'); status.textContent = 'Choose a confirmation code different from your login password.'; return;
      }
      const button = document.getElementById('ownerSecuritySubmit'); button.disabled = true;
      try {
        const data = await post(recoveringCode ? '/auth/owner/code/complete' : '/auth/owner/setup/complete', {
          token: ownerToken, confirmation_code: code.value,
          ...(recoveringCode ? { current_password: password.value } : { password: password.value })
        });
        ownerToken = ''; form.reset(); form.hidden = true;
        status.textContent = data.message;
      } catch (error) { status.classList.add('is-error'); status.textContent = error.message; }
      finally { button.disabled = false; }
    });
    return;
  }
  if (fragment.has('owner-request')) {
    show('ownerRequest');
    document.getElementById('ownerRequestForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.target.querySelector('[type="submit"]');
      const status = document.getElementById('ownerRequestStatus');
      button.disabled = true; status.classList.remove('is-error');
      try { status.textContent = (await post('/auth/owner/setup/request', {})).message; }
      catch (error) { status.classList.add('is-error'); status.textContent = error.message; }
      finally { button.disabled = false; }
    });
    return;
  }

  /* ------------------------------ verify mode ------------------------------ */
  if (verifyToken) {
    show('verify');
    const status = document.getElementById('verifyStatus');
    post('/auth/verify-email', { token: verifyToken })
      .then(() => {
        status.classList.remove('is-error');
        status.textContent = 'Email confirmed. Author accounts also require approval from the website owner before sign-in.';
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
