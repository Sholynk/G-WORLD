// Contact form submission + success dialog.
// Extracted from the legacy inline <script> so the site's Content-Security-Policy
// can keep `script-src 'self'` (no inline scripts). Behaviour is unchanged:
// urlencoded POST to the API, honeypot included, success popup on 2xx.
(() => {
  const form = document.getElementById('contactForm');
  const popup = document.getElementById('successPopup');
  const closeBtn = document.getElementById('closePopupBtn');
  if (!form || !popup || !closeBtn) return;

  function closeSuccessPopup() {
    popup.classList.add('hidden');
    popup.setAttribute('aria-hidden', 'true');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    // Submit to the CMS API served by the same origin.
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(formData).toString()
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(
            payload?.error?.message || payload?.error || `Form submission failed (${response.status})`
          );
        }
        popup.classList.remove('hidden');
        popup.setAttribute('aria-hidden', 'false');
        closeBtn.focus();
        form.reset();
      })
      .catch((error) => {
        alert('Oops! There was a problem submitting your form');
        console.error(error);
      })
      .finally(() => {
        submitBtn.disabled = false;
      });
  });

  closeBtn.addEventListener('click', closeSuccessPopup);
  popup.addEventListener('click', (event) => {
    if (event.target === popup) closeSuccessPopup();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !popup.classList.contains('hidden')) {
      closeSuccessPopup();
    }
  });
})();
