/* Sholynk CMS admin dashboard. Talks to the /api/v1 endpoints; access is a signed-in
   editorial session (sk_session cookie) — there is no admin token any more. */
(() => {
  const API = '/api/v1';
  let currentAuthor = null;
  const state = { articles: [], selectedId: null, images: [], authors: [], selectedAuthorId: null };

  const $ = (id) => document.getElementById(id);

  function readCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function goToLogin() {
    window.location.href = `/login.html?next=${encodeURIComponent('/admin/')}`;
  }

  function toast(message, isError = false) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const method = String(options.method || 'GET').toUpperCase();
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    // Session-cookie requests must echo the double-submit CSRF token.
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = readCookie('sk_csrf');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const sensitive = method === 'DELETE'
      || (['PUT', 'PATCH'].includes(method) && path === '/admin/settings')
      || (method === 'POST' && ['/admin/system/maintenance', '/auth/change-password'].includes(path));
    if (isOwner && sensitive) headers['X-Owner-Confirmation'] = await confirmSensitiveAction(method, path);
    const response = await fetch(`${API}${path}`, { ...options, method, headers, credentials: 'same-origin' });
    if (response.status === 401 && !path.startsWith('/auth/')) {
      goToLogin();
      throw new Error('Your session has expired. Please sign in again.');
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const error = detail.error || {};
      const details = Array.isArray(error.details) ? error.details.map((item) => item.message) : [];
      throw new Error(
        [(typeof error === 'string' ? error : error.message), ...details].filter(Boolean).join(' - ')
        || `HTTP ${response.status}`
      );
    }
    return response.status === 204 ? null : response.json();
  }

  /* ------------------------------- tabs --------------------------------- */

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((other) => other.classList.toggle('active', other === tab));
      document.querySelectorAll('.panel').forEach((panel) => {
        panel.hidden = panel.id !== `panel-${tab.dataset.panel}`;
      });
      if (tab.dataset.panel === 'dashboard') {
        loadDashboard();
        connectDashboardStream();
      } else {
        // Only hold the live stream open while the dashboard is on screen.
        disconnectDashboardStream();
      }
      if (tab.dataset.panel === 'accounts') loadAccounts();
      if (tab.dataset.panel === 'profile') loadSelfProfile();
      if (tab.dataset.panel === 'author-analytics') loadSelfAnalytics();
      if (tab.dataset.panel === 'authors') loadAuthors();
      if (tab.dataset.panel === 'media') loadImages();
      if (tab.dataset.panel === 'comments') loadComments();
      if (tab.dataset.panel === 'inbox') loadInbox();
      if (tab.dataset.panel === 'settings') loadSettings();
    });
  });

  /* ----------------------------- articles ------------------------------- */

  function renderList() {
    const list = $('articleList');
    const query = $('articleSearch').value.trim().toLowerCase();
    const status = $('statusFilter').value;

    const rows = state.articles.filter((article) => {
      const matchesStatus = status === 'all' || article.status === status;
      const haystack = `${article.title} ${article.category} ${article.description}`.toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });

    $('articleCount').textContent = `${rows.length} of ${state.articles.length} articles`;
    list.innerHTML = '';

    rows.forEach((article) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = article.id === state.selectedId ? 'selected' : '';

      const title = document.createElement('strong');
      title.textContent = article.title;

      const meta = document.createElement('div');
      meta.className = 'row-meta';
      const status = document.createElement('span');
      status.className = `pill ${article.status}`;
      status.textContent = article.status;
      meta.append(status);
      if (article.hero) {
        const hero = document.createElement('span');
        hero.className = 'pill hero';
        hero.textContent = 'hero';
        meta.append(hero);
      }
      const info = document.createElement('span');
      info.textContent = `${article.category} - ${article.date}`;
      meta.append(info);

      button.append(title, meta);
      button.addEventListener('click', () => selectArticle(article.id));
      item.append(button);
      list.append(item);
    });
  }

  function fillForm(article) {
    const values = article || {
      title: '', category: '', subcategory: '', contentType: 'article', slug: '', description: '',
      hook: '', directAnswer: '', img: '', alt: '', body: '', author: 'Oluwashola Busari',
      authorSlug: 'oluwashola-busari', submitterEmail: '', date: new Date().toISOString().slice(0, 10),
      readingTime: '', status: 'pending', scheduledAt: '', reviewNotes: '', heroOrder: '',
      externalLink: '', canonicalUrl: '', featured: false, hero: false, seoTitle: '',
      seoDescription: '', tags: [], keyTakeaways: [], relatedSlugs: [], faqs: [], sources: []
    };

    if (currentAuthor) {
      values.author = currentAuthor.name; values.authorSlug = currentAuthor.slug;
      if (!article) values.status = 'draft';
    }
    $('articleId').value = article?.id || '';
    $('formTitle').textContent = article ? `Editing: ${article.title}` : 'New article';
    ['title', 'category', 'subcategory', 'contentType', 'slug', 'description', 'hook',
      'directAnswer', 'img', 'alt', 'body', 'author', 'authorSlug', 'submitterEmail', 'date',
      'readingTime', 'status', 'scheduledAt', 'reviewNotes', 'externalLink', 'canonicalUrl',
      'seoTitle', 'seoDescription'].forEach((key) => {
      if ($(key)) $(key).value = values[key] ?? '';
    });
    ['tags', 'keyTakeaways', 'relatedSlugs'].forEach((key) => {
      $(key).value = Array.isArray(values[key]) ? values[key].join('\n') : '';
    });
    ['faqs', 'sources'].forEach((key) => {
      $(key).value = JSON.stringify(values[key] || [], null, 2);
    });
    $('heroOrder').value = values.heroOrder ?? '';
    $('featured').checked = Boolean(values.featured);
    $('hero').checked = Boolean(values.hero);
    $('deleteArticle').hidden = !article;
    $('previewArticle').hidden = !article;
    $('validationPanel').hidden = true;
    $('reviewBanner').hidden = true;
    setSubmitButtonLabel();
    updateImagePreview();
    updateStatusHelp();
  }

  function setSubmitButtonLabel() {
    const btn = $('submitBtn');
    if (!btn) return;
    const status = $('status')?.value;
    if (status === 'draft') {
      btn.innerHTML = '<i class="fas fa-save" aria-hidden="true"></i> Save draft';
    } else if (status === 'scheduled') {
      btn.innerHTML = '<i class="fas fa-clock" aria-hidden="true"></i> Schedule';
    } else if (status === 'published') {
      btn.innerHTML = '<i class="fas fa-save" aria-hidden="true"></i> Publish';
    } else {
      btn.innerHTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i> Submit for review';
    }
  }

  function updateStatusHelp() {
    const help = $('statusHelp');
    const status = $('status')?.value;
    if (!help) return;
    const msgs = {
      pending: 'Sends the article to Sholynk Tech for approval. It stays hidden from the public site until published.',
      draft: 'Saves without sending for review; stays visible only to admins.',
      scheduled: 'Schedules publishing at the date/time you set (requires approval on this CMS).',
      published: 'Publishes immediately. Only editors-in-chief should use this.'
    };
    const authorMessages = { draft: 'Only you and the website owner can access this draft.',
      published: 'Publish your article immediately.', scheduled: 'Publish automatically at the scheduled time while your account is active.',
      pending: 'This article is awaiting review. You may publish your own article when it is ready.' };
    help.textContent = (currentAuthor ? authorMessages[status] : msgs[status]) || '';
  }
  $('status')?.addEventListener('change', () => { setSubmitButtonLabel(); updateStatusHelp(); });

  function updateImagePreview() {
    const url = $('img').value.trim();
    const wrap = $('imagePreview');
    const tag = $('imagePreviewTag');
    if (!url) { wrap.hidden = true; return; }
    tag.src = url;
    tag.alt = $('alt').value.trim() || 'Selected hero image preview';
    wrap.hidden = false;
  }
  $('img').addEventListener('input', updateImagePreview);
  $('alt').addEventListener('input', updateImagePreview);

  // PDF import: send the file to /api/import/pdf and autofill the article
  // fields. Authors still edit/curate the result before saving.
  $('pdfImportFile').addEventListener('change', async () => {
    const file = $('pdfImportFile').files[0];
    const status = $('pdfImportStatus');
    if (!file) return;
    const previous = status?.textContent || '';
    if (status) status.textContent = `Parsing "${file.name}"… this takes a few seconds.`;
    try {
      // Extraction runs entirely in the browser (pdf.js) — nothing is uploaded
      // until the author saves the article itself.
      if (!window.SholynkPdfExtract) throw new Error('The PDF importer is still loading. Try again in a moment.');
      const draft = await window.SholynkPdfExtract.extractPdfDraft(file);
      if (draft.title && !$('title').value.trim()) $('title').value = draft.title;
      if (draft.description && !$('description').value.trim()) $('description').value = draft.description;
      if (draft.hook && !$('hook').value.trim()) $('hook').value = draft.hook;
      if (draft.body && !$('body').value.trim()) $('body').value = draft.body;
      if (draft.category && !$('category').value.trim()) $('category').value = draft.category;
      if (draft.contentType) $('contentType').value = draft.contentType;
      if (draft.readingTime && !$('readingTime').value.trim()) $('readingTime').value = draft.readingTime;
      if (Array.isArray(draft.tags) && draft.tags.length && !$('tags').value.trim()) {
        $('tags').value = draft.tags.join('\n');
      }
      if (!slugIsCustomised()) {
        $('slug').value = '';
      }
      const pages = draft.meta?.pages ? ` (${draft.meta.pages} pages)` : '';
      if (status) {
        status.textContent = `Draft extracted${pages}. Review the title, body and tags before saving.`;
      }
      toast('PDF drafted into the form — review before saving');
    } catch (error) {
      if (status) status.textContent = previous;
      toast(error.message, true);
    } finally {
      $('pdfImportFile').value = '';
    }
  });

  function slugIsCustomised() {
    const title = $('title').value.trim();
    const slug = $('slug').value.trim();
    if (!slug || !title) return Boolean(slug);
    // Mirrors the serverside slugify() in cms/lib/articles.js.
    const expected = title.toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);
    return slug !== expected;
  }

  function selectArticle(id) {
    state.selectedId = id;
    fillForm(state.articles.find((article) => article.id === id) || null);
    renderList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadArticles() {
    const payload = await request('/articles?status=all&fields=full&limit=500');
    state.articles = payload.data;
    const options = $('categoryOptions');
    options.innerHTML = '';
    [...new Set(state.articles.map((article) => article.category))].forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      options.append(option);
    });
    renderList();
  }

  $('articleSearch').addEventListener('input', renderList);
  $('statusFilter').addEventListener('change', renderList);
  $('newArticle').addEventListener('click', () => {
    state.selectedId = null;
    fillForm(null);
    renderList();
    $('title').focus();
  });

  function parseLinesOrJson(id) {
    const value = $(id).value.trim();
    if (!value) return [];
    if (value.startsWith('[')) return JSON.parse(value);
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }

  function parseJsonArray(id) {
    const value = $(id).value.trim();
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error(`${id} must be a JSON array`);
    return parsed;
  }

  function showValidation(errors) {
    const panel = $('validationPanel');
    const list = $('validationList');
    list.innerHTML = '';
    errors.forEach((msg) => {
      const li = document.createElement('li');
      li.textContent = msg;
      list.append(li);
    });
    panel.hidden = errors.length === 0;
    if (errors.length) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function validateForSubmission(payload, { isNew }) {
    const errors = [];
    const body = String(payload.body || '').trim();
    if (payload.status === 'pending') {
      if (payload.title.trim().length < 6) errors.push('Title is required (min 6 characters).');
      if (!payload.category.trim()) errors.push('Category is required.');
      if (body.length < 200) errors.push(`Article body is too short (${body.length} chars). Add at least 200 characters.`);
      if (!/<h2\b/i.test(body) && !/^##\s+/m.test(body)) {
        errors.push('Add at least one section heading (use ## heading in Markdown or <h2> in HTML) so readers can navigate the article.');
      }
      if (payload.description.trim().length < 40) errors.push('Description/teaser is required (min 40 characters).');
      if (payload.description.trim().length > 200) errors.push('Description must be under 200 characters.');
      if (isNew && !payload.author.trim()) errors.push('Author display name is required.');
      if ((payload.tags || []).length < 2) errors.push('Add at least 2 tags.');
      if (payload.img && !payload.alt.trim()) errors.push('Image alt text is required when a hero image is set.');
      if (!payload.submitterEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.submitterEmail)) {
        errors.push('A valid submitter email is required so editors can reply.');
      }
    }
    if (payload.status === 'scheduled' && !payload.scheduledAt) {
      errors.push('Scheduled publishing time is required when status is "Scheduled".');
    }
    return errors;
  }

  async function saveArticle({ forceStatus } = {}) {
    const id = $('articleId').value;
    let structured;
    try {
      structured = {
        tags: parseLinesOrJson('tags'),
        keyTakeaways: parseLinesOrJson('keyTakeaways'),
        relatedSlugs: parseLinesOrJson('relatedSlugs'),
        faqs: parseJsonArray('faqs'),
        sources: parseJsonArray('sources')
      };
    } catch (error) {
      toast(`Structured field error: ${error.message}`, true);
      return;
    }
    const payload = {
      title: $('title').value.trim(),
      category: $('category').value.trim(),
      subcategory: $('subcategory').value.trim(),
      contentType: $('contentType').value,
      slug: $('slug').value.trim(),
      description: $('description').value,
      hook: $('hook').value,
      directAnswer: $('directAnswer').value,
      ...structured,
      img: $('img').value.trim(),
      alt: $('alt').value.trim(),
      body: $('body').value,
      author: $('author').value.trim(),
      authorSlug: $('authorSlug').value.trim(),
      submitterEmail: $('submitterEmail')?.value.trim() || '',
      date: $('date').value,
      readingTime: $('readingTime').value.trim(),
      status: forceStatus || $('status').value,
      scheduledAt: $('scheduledAt').value,
      reviewNotes: $('reviewNotes').value,
      heroOrder: $('heroOrder').value,
      externalLink: $('externalLink').value.trim(),
      canonicalUrl: $('canonicalUrl').value.trim(),
      featured: $('featured').checked,
      hero: $('hero').checked,
      seoTitle: $('seoTitle').value.trim(),
      seoDescription: $('seoDescription').value.trim()
    };
    if (!payload.slug) delete payload.slug;
    if (!payload.readingTime) delete payload.readingTime;

    const errors = validateForSubmission(payload, { isNew: !id });
    showValidation(errors);
    if (errors.length) {
      toast('Please fix the highlighted issues before submitting.', true);
      return null;
    }

    try {
      const result = id
        ? await request(`/admin/articles/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await request('/admin/articles', { method: 'POST', body: JSON.stringify(payload) });
      await loadArticles();
      selectArticle(result.data.id);
      if (result.data.reviewNotice) {
        const banner = $('reviewBanner');
        banner.className = 'review-banner success';
        banner.innerHTML = `<i class="fas fa-check-circle" aria-hidden="true"></i> ${result.data.reviewNotice}`;
        banner.hidden = false;
        toast('Submitted for review — Sholynk Tech has been notified.');
      } else {
        toast(id ? 'Article updated' : 'Article saved');
      }
      return result.data;
    } catch (error) {
      // Server may return additional validation details.
      toast(error.message, true);
      return null;
    }
  }

  $('articleForm').addEventListener('submit', (event) => {
    event.preventDefault();
    saveArticle();
  });

  $('saveDraftBtn')?.addEventListener('click', async () => {
    await saveArticle({ forceStatus: 'draft' });
  });

  $('deleteArticle').addEventListener('click', async () => {
    const id = $('articleId').value;
    if (!id) return;
    if (!window.confirm('Delete this article permanently?')) return;
    try {
      await request(`/admin/articles/${id}`, { method: 'DELETE' });
      state.selectedId = null;
      await loadArticles();
      fillForm(null);
      toast('Article deleted');
    } catch (error) {
      toast(error.message, true);
    }
  });

  $('previewArticle').addEventListener('click', () => {
    const article = state.articles.find((item) => item.id === Number($('articleId').value));
    if (!article) return;
    if (article.status !== 'published') {
      toast('Save as published before opening the public preview.', true);
      return;
    }
    const destination = article.externalLink
      || `/articles/${encodeURIComponent(article.slug)}/`;
    window.open(destination, '_blank', 'noopener');
  });

  const SNIPPETS = {
    h2: '\n<h2 id="section-id">Section heading</h2>\n<p>Paragraph text.</p>\n',
    figure: '\n<figure>\n  <img src="/uploads/your-image.jpg" alt="Describe the image" loading="lazy" decoding="async"/>\n  <figcaption>Caption explaining the image.</figcaption>\n</figure>\n',
    quote: '\n<blockquote>\n  <p>A memorable pull quote.</p>\n</blockquote>\n',
    list: '\n<ul>\n  <li>First point</li>\n  <li>Second point</li>\n</ul>\n'
  };

  document.querySelectorAll('[data-snippet]').forEach((button) => {
    button.addEventListener('click', () => {
      const textarea = $('body');
      const snippet = SNIPPETS[button.dataset.snippet];
      const start = textarea.selectionStart;
      textarea.value = textarea.value.slice(0, start) + snippet + textarea.value.slice(textarea.selectionEnd);
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
    });
  });

  /* ------------------------------ authors ------------------------------- */

  /**
   * The admin is served from /admin/, but author photos are stored as paths
   * relative to the *site* root ("Images and Assets/my_pic.png") or as absolute
   * upload paths ("/uploads/..."). Resolve the former against the site root so
   * previews and list thumbnails do not 404 under /admin/.
   */
  function assetUrl(value = '') {
    const reference = String(value).trim();
    if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(reference)) return reference;
    return `/${reference.replace(/^(?:(?:\.\.?)\/)+/, '')}`;
  }

  function updateAuthorImagePreview() {
    const url = $('authorImage').value.trim();
    const wrap = $('authorImagePreview');
    const tag = $('authorImagePreviewTag');
    if (!wrap || !tag) return;
    if (!url) { wrap.hidden = true; return; }
    tag.src = assetUrl(url);
    tag.alt = $('authorImageAlt').value.trim() || 'Author profile photo preview';
    wrap.hidden = false;
  }

  function fillAuthorForm(author = null) {
    const values = author || { name: '', slug: '', role: '', bio: '', image: '', imageAlt: '', profileUrl: '' };
    $('authorId').value = author?.id || '';
    $('authorFormTitle').textContent = author ? `Editing: ${author.name}` : 'New author';
    $('authorName').value = values.name || '';
    $('authorEntitySlug').value = values.slug || '';
    $('authorRole').value = values.role || '';
    $('authorBio').value = values.bio || '';
    $('authorImage').value = values.image || '';
    $('authorImageAlt').value = values.imageAlt || '';
    $('authorProfileUrl').value = values.profileUrl || '';
    if ($('authorImageFile')) $('authorImageFile').value = '';
    $('deleteAuthor').hidden = !author;
    updateAuthorImagePreview();
  }

  /**
   * Avatar for one author row: the uploaded profile photo when the author has
   * one, otherwise their initials. Built from the saved `image` field, so a row
   * picks up a new photo as soon as the author saves an upload.
   */
  function authorAvatar(author) {
    const figure = document.createElement('span');
    figure.className = 'author-avatar';
    const initials = (author.name || 'A')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('') || 'A';

    if (author.image) {
      const img = document.createElement('img');
      img.src = assetUrl(author.image);
      img.alt = author.imageAlt || `Photo of ${author.name}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      // A broken or removed file falls back to the initials placeholder.
      img.addEventListener('error', () => {
        img.remove();
        figure.classList.add('author-avatar--initials');
        figure.textContent = initials;
      }, { once: true });
      figure.append(img);
    } else {
      figure.classList.add('author-avatar--initials');
      figure.textContent = initials;
    }
    return figure;
  }

  function renderAuthors() {
    const list = $('authorList');
    list.innerHTML = '';
    state.authors.forEach((author) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = author.id === state.selectedAuthorId ? 'selected' : '';
      const details = document.createElement('span');
      details.className = 'author-row-details';
      const name = document.createElement('strong');
      name.textContent = author.name;
      const meta = document.createElement('span');
      meta.className = 'row-meta';
      meta.textContent = author.role || author.slug;
      details.append(name, meta);
      button.append(authorAvatar(author), details);
      button.addEventListener('click', () => {
        state.selectedAuthorId = author.id;
        fillAuthorForm(author);
        renderAuthors();
      });
      item.append(button);
      list.append(item);
    });
  }

  async function loadAuthors() {
    try {
      const payload = await request('/authors');
      state.authors = payload.data || [];
      const options = $('authorOptions');
      options.innerHTML = '';
      state.authors.forEach((author) => {
        const option = document.createElement('option');
        option.value = author.slug;
        option.label = author.name;
        options.append(option);
      });
      renderAuthors();
    } catch (error) {
      toast(error.message, true);
    }
  }

  $('newAuthor').addEventListener('click', () => {
    state.selectedAuthorId = null;
    fillAuthorForm();
    renderAuthors();
    $('authorName').focus();
  });

  $('authorImage').addEventListener('input', updateAuthorImagePreview);
  $('authorImageAlt').addEventListener('input', updateAuthorImagePreview);

  // Upload a chosen profile photo straight to the media library and bind its URL
  // into the author image field, so authors can pick a photo from disk the same
  // way article hero images are uploaded.
  $('authorImageFile').addEventListener('change', async () => {
    const file = $('authorImageFile').files[0];
    if (!file) return;
    const alt = $('authorImageAlt').value.trim() || `Photo of ${$('authorName').value.trim() || 'the author'}`;
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('alt', alt);
      const response = await request('/admin/images', { method: 'POST', body: form });
      $('authorImage').value = response.data.url;
      if (!$('authorImageAlt').value.trim()) $('authorImageAlt').value = alt;
      updateAuthorImagePreview();
      toast('Profile photo uploaded and applied');
    } catch (error) {
      toast(error.message, true);
    } finally {
      $('authorImageFile').value = '';
    }
  });

  $('authorForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = $('authorId').value;
    const payload = {
      name: $('authorName').value.trim(),
      slug: $('authorEntitySlug').value.trim(),
      role: $('authorRole').value.trim(),
      bio: $('authorBio').value,
      image: $('authorImage').value.trim(),
      imageAlt: $('authorImageAlt').value.trim(),
      profileUrl: $('authorProfileUrl').value.trim()
    };
    if (!payload.slug) delete payload.slug;
    try {
      const response = await request(id ? `/admin/authors/${id}` : '/admin/authors', {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload)
      });
      await loadAuthors();
      state.selectedAuthorId = response.data.id;
      fillAuthorForm(response.data);
      renderAuthors();
      toast(id ? 'Author updated' : 'Author created');
    } catch (error) {
      toast(error.message, true);
    }
  });

  $('deleteAuthor').addEventListener('click', async () => {
    const id = $('authorId').value;
    if (!id || !window.confirm('Delete this author entity? Articles are kept.')) return;
    try {
      await request(`/admin/authors/${id}`, { method: 'DELETE' });
      state.selectedAuthorId = null;
      fillAuthorForm();
      await loadAuthors();
      toast('Author deleted');
    } catch (error) {
      toast(error.message, true);
    }
  });

  /* ------------------------------ images -------------------------------- */

  async function loadImages() {
    try {
      const payload = await request('/images');
      state.images = payload.data;
      const grid = $('mediaGrid');
      grid.innerHTML = '';
      if (!state.images.length) {
        grid.innerHTML = '<p>No images uploaded yet.</p>';
        return;
      }
      state.images.forEach((image) => {
        const card = document.createElement('div');
        card.className = 'media-card';

        const tag = document.createElement('img');
        tag.src = image.url;
        tag.alt = image.alt || image.filename;
        tag.loading = 'lazy';

        const body = document.createElement('div');
        body.className = 'media-body';
        const name = document.createElement('strong');
        name.textContent = image.filename;
        const alt = document.createElement('input');
        alt.value = image.alt;
        alt.setAttribute('aria-label', `Alt text for ${image.filename}`);
        alt.placeholder = 'Alt text';

        const actions = document.createElement('div');
        actions.className = 'media-actions';

        const useButton = document.createElement('button');
        useButton.type = 'button';
        useButton.textContent = 'Use as hero';
        useButton.addEventListener('click', () => {
          $('img').value = image.url;
          $('alt').value = alt.value;
          updateImagePreview();
          document.querySelector('.tab[data-panel="articles"]').click();
          toast('Image applied to the open article form');
        });

        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.textContent = 'Copy URL';
        copyButton.addEventListener('click', () => {
          navigator.clipboard?.writeText(image.url);
          toast('URL copied');
        });

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.textContent = 'Save alt';
        saveButton.addEventListener('click', async () => {
          try {
            await request(`/admin/images/${image.id}`, { method: 'PATCH', body: JSON.stringify({ alt: alt.value }) });
            toast('Alt text saved');
          } catch (error) {
            toast(error.message, true);
          }
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', async () => {
          if (!window.confirm(`Delete ${image.filename}?`)) return;
          try {
            await request(`/admin/images/${image.id}`, { method: 'DELETE' });
            loadImages();
            toast('Image deleted');
          } catch (error) {
            toast(error.message, true);
          }
        });

        actions.append(useButton, copyButton, saveButton, deleteButton);
        body.append(name, alt, actions);
        card.append(tag, body);
        grid.append(card);
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  $('uploadForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = $('imageFile').files[0];
    const alt = $('imageAlt').value.trim();
    if (!file) return toast('Choose an image file first', true);
    if (!alt) return toast('Alt text is required for accessibility', true);

    const form = new FormData();
    form.append('image', file);
    form.append('alt', alt);
    try {
      await request('/admin/images', { method: 'POST', body: form });
      $('uploadForm').reset();
      loadImages();
      toast('Image uploaded');
    } catch (error) {
      toast(error.message, true);
    }
    return undefined;
  });

  /* ----------------------------- comments ------------------------------ */

  function formatCommentDate(value) {
    const parsed = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(parsed.valueOf())) return value || '';
    return parsed.toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  async function loadComments() {
    const list = $('commentList');
    try {
      const payload = await request('/admin/comments?limit=200');
      const comments = payload.data || [];
      list.innerHTML = '';
      $('commentCount').textContent = `${comments.length} comment${comments.length === 1 ? '' : 's'} in the history`;
      if (!comments.length) {
        const empty = document.createElement('p');
        empty.className = 'comment-admin-empty';
        empty.textContent = 'No comments yet. Reader comments will appear here as they are posted.';
        list.append(empty);
        return;
      }
      comments.forEach((comment) => {
        const item = document.createElement('li');
        item.className = 'comment-admin-item';
        item.dataset.commentId = String(comment.id);

        const head = document.createElement('div');
        head.className = 'comment-admin-head';
        const who = document.createElement('span');
        who.className = 'comment-admin-author';
        who.textContent = `${comment.author} · ${comment.articleTitle}`;
        const when = document.createElement('time');
        when.className = 'comment-admin-time';
        when.textContent = formatCommentDate(comment.createdAt);
        head.append(who, when);

        const body = document.createElement('p');
        body.className = 'comment-admin-body';
        body.textContent = comment.body;

        const actions = document.createElement('div');
        actions.className = 'comment-admin-actions';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'danger-button';
        remove.textContent = 'Delete';
        remove.addEventListener('click', async () => {
          if (!window.confirm('Delete this comment permanently?')) return;
          try {
            await request(`/admin/comments/${comment.id}`, { method: 'DELETE' });
            item.remove();
            toast('Comment deleted');
            loadComments();
          } catch (error) {
            toast(error.message, true);
          }
        });
        actions.append(remove);

        item.append(head, body, actions);
        list.append(item);
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  $('refreshComments').addEventListener('click', loadComments);

  /* ----------------------------- settings ------------------------------- */

  async function loadSettings() {
    try {
      const payload = await request('/settings');
      Object.entries(payload.data).forEach(([key, value]) => {
        if ($(key)) $(key).value = value;
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  $('settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      siteTitle: $('siteTitle').value,
      siteDescription: $('siteDescription').value,
      siteKeywords: $('siteKeywords').value,
      homeTagline: $('homeTagline').value
    };
    try {
      await request('/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
      toast('Site metadata saved');
    } catch (error) {
      toast(error.message, true);
    }
  });

  /* ----------------------------- dashboard ------------------------------ */

  const charts = {};
  let dashboardLoading = false;
  let dashboardQueued = false;
  let dashboardStream = null;
  let streamRetry = null;

  const PALETTE = {
    blue: '#1d9bf0',
    blueSoft: 'rgba(29, 155, 240, 0.16)',
    green: '#16a34a',
    amber: '#f59e0b',
    violet: '#7c3aed',
    slate: '#64748b',
    red: '#dc2626',
    pink: '#db2777',
    teal: '#0d9488'
  };

  const numberFormat = new Intl.NumberFormat('en-US');
  const fmt = (value) => numberFormat.format(Number(value) || 0);

  function shortDate(value) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function relativeTime(value) {
    if (!value) return '';
    // SQLite timestamps are UTC but carry no zone marker; label them so the
    // browser does not read them as local time and report "in 1 hour".
    const iso = /Z|[+-]\d\d:?\d\d$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`;
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return '';
    const seconds = Math.round((Date.now() - then.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const steps = [
      { limit: 3600, div: 60, unit: 'minute' },
      { limit: 86400, div: 3600, unit: 'hour' },
      { limit: 2592000, div: 86400, unit: 'day' },
      { limit: 31536000, div: 2592000, unit: 'month' }
    ];
    for (const step of steps) {
      if (seconds < step.limit) {
        const amount = Math.round(seconds / step.div);
        return `${amount} ${step.unit}${amount === 1 ? '' : 's'} ago`;
      }
    }
    const years = Math.round(seconds / 31536000);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  }

  /** A metric card, optionally with a period-over-period delta. */
  function metricCard({ label, value, hint, trend, tone = 'blue' }) {
    const card = document.createElement('article');
    card.className = `metric-card metric-card--${tone}`;

    const labelEl = document.createElement('p');
    labelEl.className = 'metric-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('p');
    valueEl.className = 'metric-value';
    valueEl.textContent = fmt(value);

    card.append(labelEl, valueEl);

    if (trend && trend.change !== null && trend.change !== undefined) {
      const delta = document.createElement('p');
      const rising = trend.change >= 0;
      delta.className = `metric-delta ${rising ? 'up' : 'down'}`;
      delta.innerHTML = `<i class="fas fa-arrow-${rising ? 'up' : 'down'}" aria-hidden="true"></i> ${Math.abs(trend.change)}% vs previous period`;
      card.append(delta);
    } else if (trend) {
      // No baseline to compare against: state the raw figure instead of
      // implying a change we cannot compute.
      const delta = document.createElement('p');
      delta.className = 'metric-delta neutral';
      delta.textContent = `${fmt(trend.current)} this period`;
      card.append(delta);
    }

    if (hint) {
      const hintEl = document.createElement('p');
      hintEl.className = 'metric-hint';
      hintEl.textContent = hint;
      card.append(hintEl);
    }
    return card;
  }

  function renderMetrics(data) {
    const grid = $('dashMetrics');
    grid.innerHTML = '';
    const t = data.totals;
    const cards = [
      { label: 'Articles published', value: t.published, tone: 'green', trend: data.trends.published, hint: `${fmt(t.articles)} articles in total` },
      { label: 'Unpublished', value: t.unpublished, tone: 'slate', hint: `${fmt(t.drafts)} drafts, ${fmt(t.scheduled)} scheduled` },
      { label: 'Pending approval', value: t.pending, tone: t.pending > 0 ? 'amber' : 'slate', hint: t.pending > 0 ? 'Waiting on an editorial decision' : 'Nothing awaiting review' },
      { label: 'Articles read', value: t.views, tone: 'blue', trend: data.trends.views, hint: `${fmt(t.readers)} unique readers` },
      { label: 'Reactions', value: t.reactions, tone: 'violet', trend: data.trends.reactions, hint: `${fmt(t.likes)} likes, ${fmt(t.dislikes)} dislikes` },
      { label: 'Comments', value: t.comments, tone: 'pink', trend: data.trends.comments, hint: 'Across every article' },
      { label: 'Registered authors', value: t.authors, tone: 'teal', hint: 'Able to publish on the site' }
    ];
    cards.forEach((card) => grid.append(metricCard(card)));
  }

  /**
   * Creates a chart, or updates the existing one in place.
   *
   * Re-creating on every refresh would restart the animation and drop the
   * reader's hover state every few seconds on a live dashboard, so an existing
   * chart has its data swapped instead.
   */
  function paintChart(key, canvasId, config) {
    if (typeof window.Chart === 'undefined') return;
    const canvas = $(canvasId);
    if (!canvas) return;

    const existing = charts[key];
    if (existing) {
      existing.data = config.data;
      if (config.options) existing.options = { ...existing.options, ...config.options };
      existing.update();
      return;
    }
    charts[key] = new window.Chart(canvas, config);
  }

  // Respect the operating-system "reduce motion" setting: a dashboard that
  // refreshes itself would otherwise re-animate every few seconds.
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: prefersReducedMotion ? false : undefined,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, font: { size: 11 } } }
    }
  };

  /**
   * Describes a chart in words for screen readers.
   *
   * A <canvas> is opaque to assistive technology, so each graph carries a
   * hidden text equivalent that is refreshed with the same data the chart is
   * drawn from — it can never drift from what is on screen.
   */
  function describeChart(canvasId, description) {
    const target = $(`${canvasId}Summary`);
    if (target) target.textContent = description;
    const canvas = $(canvasId);
    if (canvas) canvas.setAttribute('aria-label', description);
  }

  function renderCharts(data) {
    if (typeof window.Chart === 'undefined') return;

    const labels = data.series.map((point) => shortDate(point.date));
    paintChart('activity', 'chartActivity', {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Reads',
            data: data.series.map((p) => p.views),
            borderColor: PALETTE.blue,
            backgroundColor: PALETTE.blueSoft,
            fill: true,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4
          },
          {
            label: 'Unique readers',
            data: data.series.map((p) => p.readers),
            borderColor: PALETTE.teal,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4
          },
          {
            label: 'Reactions',
            data: data.series.map((p) => p.reactions),
            borderColor: PALETTE.violet,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4
          },
          {
            label: 'Comments',
            data: data.series.map((p) => p.comments),
            borderColor: PALETTE.pink,
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4
          }
        ]
      },
      options: {
        ...baseOptions,
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(15,23,42,0.06)' } },
          x: { grid: { display: false }, ticks: { maxTicksLimit: 10, autoSkip: true } }
        }
      }
    });

    const statuses = data.statuses;
    // "Other" covers any legacy or unexpected status. Including it keeps the
    // ring equal to the total article count, so the chart can never quietly
    // disagree with the "Articles published" and "Unpublished" cards above it.
    const statusSlices = [
      { label: 'Published', value: statuses.published, colour: PALETTE.green },
      { label: 'Draft', value: statuses.draft, colour: PALETTE.slate },
      { label: 'Scheduled', value: statuses.scheduled, colour: PALETTE.blue },
      { label: 'Pending approval', value: statuses.pending, colour: PALETTE.amber },
      { label: 'Other', value: statuses.other, colour: PALETTE.violet }
    ].filter((slice) => slice.value > 0);

    paintChart('status', 'chartStatus', {
      type: 'doughnut',
      data: {
        labels: statusSlices.map((slice) => slice.label),
        datasets: [{
          data: statusSlices.map((slice) => slice.value),
          backgroundColor: statusSlices.map((slice) => slice.colour),
          borderWidth: 0
        }]
      },
      options: { ...baseOptions, cutout: '58%', plugins: { ...baseOptions.plugins, legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true, font: { size: 11 } } } } }
    });

    paintChart('reactions', 'chartReactions', {
      type: 'doughnut',
      data: {
        labels: ['Likes', 'Dislikes'],
        datasets: [{
          data: [data.totals.likes, data.totals.dislikes],
          backgroundColor: [PALETTE.green, PALETTE.red],
          borderWidth: 0
        }]
      },
      options: { ...baseOptions, cutout: '58%', plugins: { ...baseOptions.plugins, legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true, font: { size: 11 } } } } }
    });

    const topAuthors = data.authors.slice(0, 6);
    paintChart('authors', 'chartAuthors', {
      type: 'bar',
      data: {
        labels: topAuthors.map((a) => a.name),
        datasets: [
          { label: 'Published', data: topAuthors.map((a) => a.published), backgroundColor: PALETTE.green, borderRadius: 4 },
          { label: 'Pending', data: topAuthors.map((a) => a.pending), backgroundColor: PALETTE.amber, borderRadius: 4 },
          { label: 'Drafts', data: topAuthors.map((a) => a.drafts), backgroundColor: PALETTE.slate, borderRadius: 4 }
        ]
      },
      options: {
        ...baseOptions,
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(15,23,42,0.06)' } }
        }
      }
    });

    const categories = data.categories.slice(0, 8);
    paintChart('categories', 'chartCategories', {
      type: 'bar',
      data: {
        labels: categories.map((c) => c.category),
        datasets: [{ label: 'Reads', data: categories.map((c) => c.views), backgroundColor: PALETTE.blue, borderRadius: 4 }]
      },
      options: {
        ...baseOptions,
        indexAxis: 'y',
        plugins: { ...baseOptions.plugins, legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(15,23,42,0.06)' } },
          y: { grid: { display: false } }
        }
      }
    });

    // Text equivalents, generated from the same figures the charts just drew.
    const totalPeriodViews = data.series.reduce((sum, point) => sum + point.views, 0);
    const busiest = data.series.reduce(
      (best, point) => (point.views > best.views ? point : best),
      data.series[0] || { date: '', views: 0 }
    );
    describeChart('chartActivity',
      `Daily activity over ${data.trends.days} days: ${fmt(totalPeriodViews)} reads in total`
      + `${busiest.views > 0 ? `, busiest on ${shortDate(busiest.date)} with ${fmt(busiest.views)} reads` : ''}.`);

    describeChart('chartStatus',
      `Publication status of ${fmt(data.totals.articles)} articles: `
      + `${statusSlices.map((slice) => `${fmt(slice.value)} ${slice.label.toLowerCase()}`).join(', ') || 'none recorded'}.`);

    describeChart('chartReactions',
      `Reaction record: ${fmt(data.totals.likes)} likes and ${fmt(data.totals.dislikes)} dislikes.`);

    describeChart('chartAuthors', topAuthors.length
      ? `Articles per author: ${topAuthors.map((author) => `${author.name}, ${fmt(author.published)} published`).join('; ')}.`
      : 'No authors registered yet.');

    describeChart('chartCategories', categories.length
      ? `Reads by category: ${categories.map((item) => `${item.category}, ${fmt(item.views)} reads`).join('; ')}.`
      : 'No category reads recorded yet.');
  }

  function emptyRow(table, columns, message) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns;
    cell.className = 'table-empty';
    cell.textContent = message;
    row.append(cell);
    table.append(row);
  }

  function renderAuthorTable(data) {
    const body = $('authorTableBody');
    body.innerHTML = '';
    if (!data.authors.length) {
      emptyRow(body, 7, 'No authors registered yet.');
      return;
    }
    data.authors.forEach((author) => {
      const row = document.createElement('tr');

      const nameCell = document.createElement('td');
      const identity = document.createElement('span');
      identity.className = 'table-identity';
      identity.append(authorAvatar(author));
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = author.name;
      const meta = document.createElement('small');
      meta.textContent = author.role || author.slug;
      text.append(strong, document.createElement('br'), meta);
      identity.append(text);
      nameCell.append(identity);
      row.append(nameCell);

      [author.published, author.pending, author.drafts, author.views, author.reactions, author.comments]
        .forEach((value) => {
          const cell = document.createElement('td');
          cell.className = 'num';
          cell.textContent = fmt(value);
          row.append(cell);
        });
      body.append(row);
    });
  }

  function renderTopArticles(data) {
    const body = $('topArticleBody');
    body.innerHTML = '';
    const rows = data.topArticles.filter((article) => article.views > 0);
    if (!rows.length) {
      emptyRow(body, 5, 'No reads recorded yet. Figures appear here as readers open articles.');
      return;
    }
    rows.forEach((article) => {
      const row = document.createElement('tr');
      const titleCell = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = article.title;
      const meta = document.createElement('small');
      meta.textContent = `${article.category} - ${article.author}`;
      titleCell.append(strong, document.createElement('br'), meta);
      row.append(titleCell);
      [article.views, article.readers, article.likes, article.comments].forEach((value) => {
        const cell = document.createElement('td');
        cell.className = 'num';
        cell.textContent = fmt(value);
        row.append(cell);
      });
      body.append(row);
    });
  }

  const ACTIVITY_ICONS = {
    comment: 'fa-comment',
    like: 'fa-thumbs-up',
    dislike: 'fa-thumbs-down',
    published: 'fa-circle-check',
    article: 'fa-pen-nib'
  };

  function renderActivity(data) {
    const feed = $('activityFeed');
    feed.innerHTML = '';
    if (!data.activity.length) {
      const empty = document.createElement('li');
      empty.className = 'activity-empty';
      empty.textContent = 'No activity recorded yet.';
      feed.append(empty);
      return;
    }
    data.activity.forEach((event) => {
      const item = document.createElement('li');
      item.className = `activity-item activity-item--${event.type}`;

      const icon = document.createElement('span');
      icon.className = 'activity-icon';
      icon.innerHTML = `<i class="fas ${ACTIVITY_ICONS[event.type] || 'fa-circle'}" aria-hidden="true"></i>`;

      const bodyEl = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = event.title;
      const detail = document.createElement('small');
      detail.textContent = `${event.detail} - ${relativeTime(event.at)}`;
      bodyEl.append(title, document.createElement('br'), detail);
      if (event.body) {
        const quote = document.createElement('p');
        quote.className = 'activity-quote';
        quote.textContent = event.body;
        bodyEl.append(quote);
      }
      item.append(icon, bodyEl);
      feed.append(item);
    });
  }

  function setLiveState(state, label) {
    const badge = $('dashLive');
    if (!badge) return;
    badge.dataset.state = state;
    $('dashLiveLabel').textContent = label;
  }

  async function loadDashboard() {
    if (currentAuthor) return;
    // A burst of reader activity can fire several change events at once.
    // Collapse them: run one refresh, and queue at most one more behind it.
    if (dashboardLoading) {
      dashboardQueued = true;
      return;
    }
    dashboardLoading = true;
    try {
      const days = Number($('dashRange').value) || 30;
      const payload = await request(`/admin/analytics/overview?days=${days}`);
      const data = payload.data;

      renderMetrics(data);
      renderAuthorTable(data);
      renderTopArticles(data);
      renderActivity(data);
      // Charts are the one part that depends on a third-party library and a
      // live canvas. If that fails, the numbers and tables above are still
      // correct and must stay on screen rather than being taken down with it.
      let chartError = null;
      try {
        renderCharts(data);
      } catch (error) {
        chartError = error;
        console.error('Dashboard charts failed to render:', error);
      }

      $('chartActivityNote').textContent = `Daily totals over the last ${data.trends.days} days.`;
      const stamp = new Date(data.generatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (typeof window.Chart === 'undefined') {
        $('dashUpdated').textContent = `Updated ${stamp}. Charts unavailable offline - metrics and tables still live.`;
      } else if (chartError) {
        $('dashUpdated').textContent = `Updated ${stamp}. Charts could not be drawn - metrics and tables are current.`;
      } else {
        $('dashUpdated').textContent = `Updated ${stamp}`;
      }
    } catch (error) {
      $('dashUpdated').textContent = error.message;
      toast(error.message, true);
    } finally {
      dashboardLoading = false;
      if (dashboardQueued) {
        dashboardQueued = false;
        loadDashboard();
      }
    }
  }

  /**
   * Subscribes to the server's change stream so the dashboard reflects reader
   * and editorial activity without anyone pressing refresh.
   *
   * The session cookie rides along automatically. If the stream cannot be
   * established the dashboard falls back to polling rather than going stale.
   */
  function connectDashboardStream() {
    if (currentAuthor || dashboardStream || typeof window.EventSource === 'undefined') return;
    // The session cookie authenticates the stream (EventSource sends cookies
    // same-origin); no token ever travels in the URL.
    const url = `${API}/admin/analytics/stream`;

    setLiveState('connecting', 'Connecting');
    const source = new EventSource(url);
    dashboardStream = source;

    source.addEventListener('ready', () => setLiveState('live', 'Live'));
    source.addEventListener('change', () => {
      if (!$('panel-dashboard').hidden) loadDashboard();
    });
    source.onerror = () => {
      setLiveState('reconnecting', 'Reconnecting');
      // EventSource retries on its own; only rebuild if it gave up entirely.
      if (source.readyState === EventSource.CLOSED) {
        dashboardStream = null;
        clearTimeout(streamRetry);
        streamRetry = setTimeout(connectDashboardStream, 8000);
      }
    };
  }

  function disconnectDashboardStream() {
    clearTimeout(streamRetry);
    dashboardStream?.close();
    dashboardStream = null;
  }

  $('refreshDashboard').addEventListener('click', () => loadDashboard());
  $('dashRange').addEventListener('change', () => loadDashboard());

  // Nothing to update while the tab is in the background; reconnect and catch
  // up as soon as it is visible again.
  document.addEventListener('visibilitychange', () => {
    if ($('panel-dashboard').hidden) return;
    if (document.hidden) {
      disconnectDashboardStream();
    } else {
      connectDashboardStream();
      loadDashboard();
    }
  });

  /* -------------------------------- inbox -------------------------------- */

  function formatInboxDate(value) {
    const parsed = new Date(String(value).replace(' ', 'T') + (/[Z+]|-\d\d:?\d\d$/.test(String(value)) ? '' : 'Z'));
    if (Number.isNaN(parsed.valueOf())) return value || '';
    return parsed.toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function emptyTableRow(table, columns, message) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = columns;
    cell.className = 'table-empty';
    cell.textContent = message;
    row.append(cell);
    table.append(row);
  }

  async function loadSubscribers() {
    const body = $('subscriberTableBody');
    try {
      const payload = await request('/admin/subscriptions');
      const subscribers = payload.data || [];
      body.innerHTML = '';
      $('subscriberCount').textContent = `${subscribers.length} subscriber${subscribers.length === 1 ? '' : 's'}`;
      if (!subscribers.length) {
        emptyTableRow(body, 5, 'No subscribers yet. Signups from the footer form appear here.');
        return;
      }
      subscribers.forEach((subscriber) => {
        const row = document.createElement('tr');
        const cells = [subscriber.name || '(no name)', subscriber.email, subscriber.status, formatInboxDate(subscriber.createdAt)];
        cells.forEach((text) => {
          const cell = document.createElement('td');
          cell.textContent = text;
          row.append(cell);
        });
        const actions = document.createElement('td');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'danger-button';
        remove.textContent = 'Delete';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`Remove ${subscriber.email} from the newsletter?`)) return;
          try {
            await request(`/admin/subscriptions/${subscriber.id}`, { method: 'DELETE' });
            toast('Subscriber removed');
            loadSubscribers();
          } catch (error) {
            toast(error.message, true);
          }
        });
        actions.append(remove);
        row.append(actions);
        body.append(row);
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function loadMessages() {
    const list = $('messageList');
    try {
      const payload = await request('/admin/contact-messages');
      const messages = payload.data || [];
      list.innerHTML = '';
      $('messageCount').textContent = `${messages.length} message${messages.length === 1 ? '' : 's'}`;
      if (!messages.length) {
        const empty = document.createElement('p');
        empty.className = 'comment-admin-empty';
        empty.textContent = 'No contact messages yet.';
        list.append(empty);
        return;
      }
      messages.forEach((message) => {
        const item = document.createElement('li');
        item.className = 'comment-admin-item';

        const head = document.createElement('div');
        head.className = 'comment-admin-head';
        const who = document.createElement('span');
        who.className = 'comment-admin-author';
        who.textContent = `${message.name} <${message.email}> · ${message.subject}`;
        const when = document.createElement('time');
        when.className = 'comment-admin-time';
        when.textContent = formatInboxDate(message.createdAt);
        head.append(who, when);

        const body = document.createElement('p');
        body.className = 'comment-admin-body';
        body.textContent = message.message;

        const actions = document.createElement('div');
        actions.className = 'comment-admin-actions';

        const statusButton = document.createElement('button');
        statusButton.type = 'button';
        statusButton.className = 'ghost-button';
        statusButton.textContent = message.status === 'new' ? 'Mark read' : 'Mark new';
        statusButton.addEventListener('click', async () => {
          const next = message.status === 'new' ? 'read' : 'new';
          try {
            await request(`/admin/contact-messages/${message.id}`, {
              method: 'PATCH', body: JSON.stringify({ status: next })
            });
            toast(`Message marked ${next}`);
            loadMessages();
          } catch (error) {
            toast(error.message, true);
          }
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'danger-button';
        remove.textContent = 'Delete';
        remove.addEventListener('click', async () => {
          if (!window.confirm('Delete this message permanently?')) return;
          try {
            await request(`/admin/contact-messages/${message.id}`, { method: 'DELETE' });
            toast('Message deleted');
            loadMessages();
          } catch (error) {
            toast(error.message, true);
          }
        });

        actions.append(statusButton, remove);
        item.append(head, body, actions);
        list.append(item);
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  function loadInbox() {
    loadSubscribers();
    loadMessages();
  }

  let sensitiveResolve = null;
  function confirmSensitiveAction(method, path) {
    if (sensitiveResolve) return Promise.reject(new Error('Finish the current confirmation first.'));
    const noun = path.startsWith('/admin/articles/') ? 'article' : path.startsWith('/admin/images/') ? 'image'
      : path.startsWith('/admin/authors/') ? 'author profile' : 'record';
    $('sensitiveConfirmationDescription').textContent = method === 'DELETE' ? `Permanently delete this ${noun}?`
      : path === '/admin/settings' ? 'Save changes to site metadata?' : 'Confirm this sensitive owner action?';
    $('sensitiveConfirmationCode').value = '';
    $('sensitiveConfirmation').showModal();
    return new Promise((resolve, reject) => {
      sensitiveResolve = (code) => code ? resolve(code) : reject(new Error('Action cancelled. Nothing was changed.'));
    });
  }
  $('sensitiveConfirmationForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const finish = sensitiveResolve; sensitiveResolve = null;
    const code = $('sensitiveConfirmationCode').value;
    $('sensitiveConfirmationCode').value = '';
    $('sensitiveConfirmation').close();
    finish?.(code);
  });
  $('cancelSensitiveConfirmation').addEventListener('click', () => $('sensitiveConfirmation').close());
  $('sensitiveConfirmation').addEventListener('close', () => {
    const finish = sensitiveResolve; sensitiveResolve = null;
    $('sensitiveConfirmationCode').value = ''; finish?.(null);
  });
  $('recoverOwnerCode').addEventListener('click', async (event) => {
    event.target.disabled = true;
    try { toast((await request('/auth/owner/code/request', { method: 'POST', body: '{}' })).data.message); }
    catch (error) { toast(error.message, true); }
    finally { event.target.disabled = false; }
  });

  /* ----------------------- author self-service --------------------------- */
  const socialInputs = { x: 'selfSocialX', linkedin: 'selfSocialLinkedin', github: 'selfSocialGithub', instagram: 'selfSocialInstagram', youtube: 'selfSocialYoutube' };
  let selfProfile = null;
  let selfAnalyticsPage = 1;
  async function loadSelfProfile() {
    if (!currentAuthor) return;
    const status = $('selfProfileStatus'); status.textContent = 'Loading your profile…';
    try {
      selfProfile = (await request('/admin/author/profile')).data;
      const fields = { name: 'selfName', bio: 'selfBio', image: 'selfImage', imageAlt: 'selfImageAlt', profileUrl: 'selfProfileUrl' };
      Object.entries(fields).forEach(([key, id]) => { $(id).value = selfProfile[key] || ''; });
      Object.entries(socialInputs).forEach(([key, id]) => { $(id).value = selfProfile.socialLinks?.[key] || ''; });
      currentAuthor.name = selfProfile.name; currentAuthor.slug = selfProfile.slug;
      $('author').value = selfProfile.name; $('authorSlug').value = selfProfile.slug;
      status.textContent = 'Your public profile is ready to edit.';
    } catch (error) { status.textContent = error.message; }
  }
  $('selfProfileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
    const socialLinks = { ...(selfProfile?.socialLinks || {}) };
    Object.entries(socialInputs).forEach(([key, id]) => { socialLinks[key] = $(id).value.trim(); });
    try {
      const payload = { name: $('selfName').value.trim(), bio: $('selfBio').value.trim(), image: $('selfImage').value.trim(),
        imageAlt: $('selfImageAlt').value.trim(), profileUrl: $('selfProfileUrl').value.trim(), socialLinks };
      selfProfile = (await request('/admin/author/profile', { method: 'PATCH', body: JSON.stringify(payload) })).data;
      currentAuthor.name = selfProfile.name;
      $('sessionUser').textContent = selfProfile.name; $('author').value = selfProfile.name;
      $('selfProfileStatus').textContent = 'Your profile and article bylines have been updated.';
      await loadArticles();
    } catch (error) { $('selfProfileStatus').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('selfImageFile').addEventListener('change', async () => {
    const file = $('selfImageFile').files[0]; if (!file) return;
    const alt = $('selfImageAlt').value.trim() || `Photo of ${$('selfName').value.trim() || 'the author'}`;
    const data = new FormData(); data.append('image', file); data.append('alt', alt);
    $('selfImageFile').disabled = true;
    try {
      const result = await request('/admin/images', { method: 'POST', body: data });
      $('selfImage').value = result.data.url; $('selfImageAlt').value = alt;
      $('selfProfileStatus').textContent = 'Photo uploaded to your library. Save your profile to apply it.';
    } catch (error) { $('selfProfileStatus').textContent = error.message; }
    finally { $('selfImageFile').value = ''; $('selfImageFile').disabled = false; }
  });
  async function loadSelfAnalytics() {
    if (!currentAuthor) return;
    $('selfAnalyticsStatus').textContent = 'Loading your article analytics…';
    try {
      const data = (await request(`/admin/author/analytics?days=${$('selfAnalyticsDays').value}&page=${selfAnalyticsPage}`)).data;
      const totals = $('selfAnalyticsTotals'); totals.replaceChildren();
      const labels = { articles: 'Articles', published: 'Published', drafts: 'Drafts', views: 'Reads', comments: 'Comments', reactions: 'Reactions' };
      Object.entries(labels).forEach(([key, label]) => {
        const card = document.createElement('div'); card.className = 'author-metric';
        const number = document.createElement('strong'); number.textContent = Number(data.totals[key] || 0).toLocaleString();
        const caption = document.createElement('span'); caption.textContent = label; card.append(number, caption); totals.append(card);
      });
      const rows = $('selfAnalyticsRows'); rows.replaceChildren();
      data.items.forEach((article) => {
        const row = document.createElement('tr');
        [article.title, article.status, article.views, article.comments, article.reactions].forEach((value) => {
          const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell);
        }); rows.append(row);
      });
      $('selfAnalyticsStatus').textContent = data.items.length ? 'Only your articles are included.' : 'No articles on this page yet.';
      $('selfAnalyticsPage').textContent = `Page ${selfAnalyticsPage}`;
      $('previousSelfAnalytics').disabled = selfAnalyticsPage === 1;
      $('nextSelfAnalytics').disabled = selfAnalyticsPage * 50 >= data.totals.articles;
    } catch (error) { $('selfAnalyticsStatus').textContent = error.message; }
  }
  $('refreshSelfAnalytics').addEventListener('click', loadSelfAnalytics);
  $('selfAnalyticsDays').addEventListener('change', () => { selfAnalyticsPage = 1; loadSelfAnalytics(); });
  $('previousSelfAnalytics').addEventListener('click', () => { selfAnalyticsPage = Math.max(1, selfAnalyticsPage - 1); loadSelfAnalytics(); });
  $('nextSelfAnalytics').addEventListener('click', () => { selfAnalyticsPage++; loadSelfAnalytics(); });

  /* -------------------------- owner account access ----------------------- */
  let accountPage = 1;
  let accountAction = null;
  let isOwner = false;
  async function loadAccounts() {
    if (!isOwner) return;
    const status = $('accountAccessStatus');
    status.textContent = 'Loading author accounts…';
    try {
      const response = await request(`/admin/accounts?page=${accountPage}`);
      const items = response.data.items;
      $('pendingAccountCount').textContent = response.data.pending ? `(${response.data.pending} pending)` : '';
      const list = $('accountAccessList');
      list.replaceChildren();
      status.textContent = items.length ? 'Review applications and manage access below.' : 'No applications on this page.';
      $('previousAccounts').disabled = accountPage === 1;
      $('nextAccounts').disabled = items.length < 50;
      $('accountPage').textContent = `Page ${accountPage}`;
      items.forEach((account) => {
        const item = document.createElement('li');
        const summary = document.createElement('p');
        summary.textContent = `${account.display_name || 'Author'} · ${account.email} · ${account.review_status} · ${account.account_status} · ${account.email_verified_at ? 'Email verified' : 'Email not verified'}`;
        item.append(summary);
        let actions = [];
        if (account.review_status === 'pending') actions = ['approve', 'decline'];
        if (account.review_status === 'approved' && account.account_status === 'active') actions = ['suspend'];
        if (account.review_status === 'approved' && account.account_status === 'suspended') actions = ['restore'];
        actions.forEach((action) => {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'ghost-button';
          button.textContent = action.charAt(0).toUpperCase() + action.slice(1);
          button.disabled = action === 'approve' && !account.email_verified_at;
          button.addEventListener('click', () => {
            accountAction = { userId: account.user_id, action };
            $('accountConfirmationDescription').textContent = `${button.textContent} ${account.email}?`;
            $('accountConfirmationCode').value = '';
            $('accountConfirmationError').textContent = '';
            $('accountConfirmation').showModal();
          });
          item.append(button);
        });
        list.append(item);
      });
    } catch (error) { status.textContent = error.message; }
  }
  $('refreshAccounts').addEventListener('click', () => loadAccounts());
  $('previousAccounts').addEventListener('click', () => { accountPage = Math.max(1, accountPage - 1); loadAccounts(); });
  $('nextAccounts').addEventListener('click', () => { accountPage++; loadAccounts(); });
  $('cancelAccountConfirmation').addEventListener('click', () => $('accountConfirmation').close());
  $('accountConfirmation').addEventListener('close', () => { accountAction = null; $('accountConfirmationCode').value = ''; });
  $('accountConfirmationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!accountAction) return;
    const action = accountAction;
    const button = event.target.querySelector('[type="submit"]');
    button.disabled = true;
    const code = $('accountConfirmationCode').value;
    $('accountConfirmationCode').value = '';
    try {
      const result = await request(`/admin/accounts/${encodeURIComponent(action.userId)}`, {
        method: 'POST', body: JSON.stringify({ action: action.action, confirmation_code: code })
      });
      $('accountConfirmation').close();
      toast(result.data.email_delivered ? 'Account updated and email sent.' : 'Account updated. Email delivery needs attention.');
      await loadAccounts();
    } catch (error) { $('accountConfirmationError').textContent = error.message; }
    finally { button.disabled = false; }
  });

  /* -------------------------------- boot -------------------------------- */

  // Navigation is capability-driven: a contributing editor only holds
  // `article.submit` + `media.write`, so a tab whose data they cannot read is
  // hidden rather than left to fail with a 403 toast when opened.
  const sessionPermissions = new Set();
  const TAB_PERMISSIONS = {
    dashboard: 'analytics.read',
    articles: 'article.submit',
    authors: 'author.write',
    media: 'media.write',
    comments: 'engagement.moderate',
    inbox: 'inbox.read',
    settings: 'settings.write'
  };

  function tabVisible(panel) {
    const tab = document.querySelector(`.tab[data-panel="${panel}"]`);
    return Boolean(tab && !tab.hidden);
  }

  /** The dashboard is the default panel; fall back to the first tab this session may use. */
  function activateFirstVisibleTab() {
    const active = document.querySelector('.tab.active');
    if (active && !active.hidden) return;
    document.querySelector('.tab:not([hidden])')?.click();
  }

  async function bootSession() {
    try {
      const response = await fetch(`${API}/auth/me`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('unauthenticated');
      const payload = await response.json();
      const user = payload.data?.user;
      $('sessionUser').textContent = user?.display_name || user?.full_name || user?.email || 'Signed in';
      $('sessionState').hidden = false;
      sessionPermissions.clear();
      for (const permission of payload.data?.permissions ?? []) sessionPermissions.add(permission);
      document.querySelectorAll('.tab').forEach((tab) => {
        const required = TAB_PERMISSIONS[tab.dataset.panel];
        if (required && !sessionPermissions.has(required)) tab.hidden = true;
      });
      const capabilities = await request('/admin/accounts/capabilities');
      currentAuthor = capabilities.data.author || null;
      isOwner = capabilities.data.owner === true;
      $('accountAccessTab').hidden = !isOwner;
      if (isOwner) loadAccounts();
      if (currentAuthor) {
        $('workspaceLabel').textContent = 'Author workspace';
        document.title = 'My author workspace — Sholynk Tech';
        const allowed = new Set(['articles', 'media', 'comments', 'profile', 'author-analytics']);
        document.querySelectorAll('.tab').forEach((tab) => {
          tab.hidden = !allowed.has(tab.dataset.panel);
          if (['articles', 'media', 'comments'].includes(tab.dataset.panel)) tab.textContent = `My ${tab.dataset.panel}`;
        });
        ['author', 'authorSlug', 'submitterEmail'].forEach((id) => { $(id).readOnly = true; });
        ['featured', 'hero'].forEach((id) => { $(id).disabled = true; $(id).closest('label').hidden = true; });
        $('heroOrder').disabled = true; $('heroOrder').closest('.field').hidden = true;
        document.querySelector('.tab[data-panel="articles"]').click();
      }
      activateFirstVisibleTab();
      $('adminMain').hidden = false;
      $('adminNavigation').hidden = false;
      $('adminLoading').hidden = true;
      return user;
    } catch (error) {
      goToLogin();
      return null;
    }
  }

  $('signOutBtn')?.addEventListener('click', async () => {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch (error) {
      // Signing out locally is enough even if the server call failed.
    }
    window.location.href = '/';
  });

  bootSession().then((user) => {
    if (!user) return;
    fillForm(null);
    loadArticles().catch((error) => toast(error.message, true));
    if (currentAuthor) { loadSelfProfile(); }
    else {
      if (tabVisible('authors')) loadAuthors();
      if (tabVisible('dashboard')) { loadDashboard(); connectDashboardStream(); }
    }
  });
})();
