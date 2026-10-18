/**
 * Live reader engagement backed exclusively by the Express API and SQLite.
 * localStorage holds only an anonymous voter identifier; reactions, comments
 * and read counts are never persisted or queued in the browser.
 */
window.SholynkEngagement = (() => {
  const VOTER_KEY = 'sholynk:voter-id';
  const MAX_AUTHOR_LENGTH = 60;
  const MAX_COMMENT_LENGTH = 2000;

  function newClientId() {
    return window.crypto?.randomUUID?.()
      || `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function safeStorage() {
    try {
      const probe = '__sholynk_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (error) {
      const memory = new Map();
      return {
        getItem: (key) => (memory.has(key) ? memory.get(key) : null),
        setItem: (key, value) => memory.set(key, String(value))
      };
    }
  }

  const store = safeStorage();

  /** Anonymous browser id used to enforce one reaction per reader. */
  function voterId() {
    let id = store.getItem(VOTER_KEY);
    if (!id) {
      id = window.crypto?.randomUUID?.()
        || `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      store.setItem(VOTER_KEY, id);
    }
    return id;
  }

  const cms = window.SholynkCMS;

  function apiRequest(path, options) {
    if (!cms || typeof cms.apiRequest !== 'function') {
      return Promise.reject(new Error('The engagement service is unavailable'));
    }
    return cms.apiRequest(path, options);
  }

  async function getEngagement(slug) {
    const payload = await apiRequest(
      `/articles/${encodeURIComponent(slug)}/engagement?voterId=${encodeURIComponent(voterId())}`
    );
    return {
      reactions: payload.data.reactions,
      comments: Array.isArray(payload.data.comments) ? payload.data.comments : []
    };
  }

  async function sendReaction(slug, type) {
    const payload = await apiRequest(`/articles/${encodeURIComponent(slug)}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, voterId: voterId() })
    });
    return payload.data;
  }

  async function sendComment(slug, { author, body, clientId }) {
    const payload = await apiRequest(`/articles/${encodeURIComponent(slug)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, body, voterId: voterId(), clientId })
    });
    return payload.data;
  }

  /* ------------------------------- helpers -------------------------------- */

  function formatDate(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) return '';
    const diffMs = Date.now() - parsed.valueOf();
    const diffMinutes = Math.round(diffMs / 60000);
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?';
  }

  function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
  }

  /* ------------------------------ reactions UI ----------------------------- */

  function buildReactions(slug) {
    const section = document.createElement('section');
    section.className = 'reactions';
    section.setAttribute('aria-label', 'Article reactions');

    const prompt = document.createElement('p');
    prompt.className = 'reactions-prompt';
    prompt.textContent = 'Was this article useful?';

    const group = document.createElement('div');
    group.className = 'reaction-buttons';

    function makeButton(type, iconClass, label) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `reaction-btn reaction-btn--${type}`;
      button.dataset.reaction = type;

      const icon = document.createElement('i');
      icon.className = iconClass;
      icon.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.className = 'reaction-label';
      text.textContent = label;

      const count = document.createElement('span');
      count.className = 'reaction-count';
      count.textContent = '0';

      button.append(icon, text, count);
      return button;
    }

    const likeButton = makeButton('like', 'fas fa-thumbs-up', 'Like');
    const dislikeButton = makeButton('dislike', 'fas fa-thumbs-down', 'Dislike');

    const status = document.createElement('p');
    status.className = 'reactions-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    group.append(likeButton, dislikeButton);
    section.append(prompt, group, status);

    let current = { likes: 0, dislikes: 0, mine: null };
    let pending = false;

    function paint(state) {
      current = state;
      likeButton.querySelector('.reaction-count').textContent = String(state.likes);
      dislikeButton.querySelector('.reaction-count').textContent = String(state.dislikes);

      likeButton.classList.toggle('is-active', state.mine === 'like');
      dislikeButton.classList.toggle('is-active', state.mine === 'dislike');
      likeButton.setAttribute('aria-pressed', state.mine === 'like' ? 'true' : 'false');
      dislikeButton.setAttribute('aria-pressed', state.mine === 'dislike' ? 'true' : 'false');

      likeButton.setAttribute('aria-label', `Like this article. ${plural(state.likes, 'like')}.`);
      dislikeButton.setAttribute(
        'aria-label',
        `Dislike this article. ${plural(state.dislikes, 'dislike')}.`
      );

      if (state.mine === 'like') status.textContent = 'You liked this article. Click again to undo.';
      else if (state.mine === 'dislike') status.textContent = 'You disliked this article. Click again to undo.';
      else status.textContent = '';
    }

    async function vote(type) {
      // Guard against double-submits while a request is in flight; this is the
      // spam-click protection on top of the one-vote-per-voter rule.
      if (pending) return;
      pending = true;
      group.classList.add('is-busy');

      const previous = { ...current };

      // Optimistic update: recompute locally and paint before the round trip.
      const optimistic = { ...current };
      if (optimistic.mine === type) {
        if (type === 'like') optimistic.likes = Math.max(0, optimistic.likes - 1);
        else optimistic.dislikes = Math.max(0, optimistic.dislikes - 1);
        optimistic.mine = null;
      } else {
        if (optimistic.mine === 'like') optimistic.likes = Math.max(0, optimistic.likes - 1);
        if (optimistic.mine === 'dislike') optimistic.dislikes = Math.max(0, optimistic.dislikes - 1);
        if (type === 'like') optimistic.likes += 1;
        else optimistic.dislikes += 1;
        optimistic.mine = type;
      }
      paint(optimistic);

      try {
        paint(await sendReaction(slug, type));
      } catch (error) {
        // Reconcile: the server is the source of truth, so roll back on failure.
        paint(previous);
        status.textContent = 'Could not save your reaction. Please try again.';
      } finally {
        pending = false;
        group.classList.remove('is-busy');
      }
    }

    likeButton.addEventListener('click', () => vote('like'));
    dislikeButton.addEventListener('click', () => vote('dislike'));

    return {
      element: section,
      paint,
      setUnavailable(message) {
        likeButton.disabled = true;
        dislikeButton.disabled = true;
        status.textContent = message;
      }
    };
  }

  /* ------------------------------- comments UI ----------------------------- */

  function buildComments(slug) {
    const section = document.createElement('section');
    section.className = 'comments';
    section.id = 'comments';
    section.setAttribute('aria-labelledby', 'comments-title');

    const heading = document.createElement('h2');
    heading.className = 'comments-title';
    heading.id = 'comments-title';
    heading.textContent = 'Comments';

    const countLabel = document.createElement('span');
    countLabel.className = 'comments-count';
    heading.append(' ', countLabel);

    /* ------------------------------- form -------------------------------- */

    const form = document.createElement('form');
    form.className = 'comment-form';
    form.noValidate = true; // We render our own messages rather than native bubbles.

    const nameField = document.createElement('div');
    nameField.className = 'comment-field';
    const nameLabel = document.createElement('label');
    nameLabel.setAttribute('for', 'commentName');
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.id = 'commentName';
    nameInput.name = 'name';
    nameInput.type = 'text';
    nameInput.autocomplete = 'name';
    nameInput.placeholder = 'Your name';
    nameInput.maxLength = MAX_AUTHOR_LENGTH;
    const nameError = document.createElement('p');
    nameError.className = 'comment-error';
    nameError.id = 'commentNameError';
    nameField.append(nameLabel, nameInput, nameError);

    const bodyField = document.createElement('div');
    bodyField.className = 'comment-field';
    const bodyLabel = document.createElement('label');
    bodyLabel.setAttribute('for', 'commentBody');
    bodyLabel.textContent = 'Comment';
    const bodyInput = document.createElement('textarea');
    bodyInput.id = 'commentBody';
    bodyInput.name = 'comment';
    bodyInput.rows = 4;
    bodyInput.placeholder = 'Share your thoughts on this article...';
    bodyInput.maxLength = MAX_COMMENT_LENGTH;
    const bodyError = document.createElement('p');
    bodyError.className = 'comment-error';
    bodyError.id = 'commentBodyError';
    bodyField.append(bodyLabel, bodyInput, bodyError);

    const actions = document.createElement('div');
    actions.className = 'comment-actions';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'comment-submit';
    submit.textContent = 'Post comment';
    const formStatus = document.createElement('p');
    formStatus.className = 'comment-status';
    formStatus.setAttribute('role', 'status');
    formStatus.setAttribute('aria-live', 'polite');
    actions.append(submit, formStatus);

    form.append(nameField, bodyField, actions);

    const list = document.createElement('ol');
    list.className = 'comment-list';

    const empty = document.createElement('p');
    empty.className = 'comment-empty';
    empty.textContent = 'No comments yet. Be the first to share your thoughts.';

    section.append(heading, form, empty, list);

    let comments = [];

    function renderCount() {
      countLabel.textContent = `(${comments.length})`;
      empty.hidden = comments.length > 0;
    }

    function renderComment(comment, { isNew = false } = {}) {
      const item = document.createElement('li');
      item.className = `comment${isNew ? ' is-new' : ''}`;
      if (comment.id != null) item.dataset.commentId = String(comment.id);

      const avatar = document.createElement('div');
      avatar.className = 'comment-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = initials(comment.author);

      const content = document.createElement('div');
      content.className = 'comment-content';

      const header = document.createElement('div');
      header.className = 'comment-header';
      const author = document.createElement('span');
      author.className = 'comment-author';
      // textContent throughout: comment text is never parsed as HTML.
      author.textContent = comment.author;
      const time = document.createElement('time');
      time.className = 'comment-time';
      if (comment.createdAt) time.dateTime = comment.createdAt;
      time.textContent = formatDate(comment.createdAt);
      header.append(author, time);

      const body = document.createElement('p');
      body.className = 'comment-body';
      body.textContent = comment.body;

      content.append(header, body);
      item.append(avatar, content);
      return item;
    }

    function renderAll() {
      list.innerHTML = '';
      const fragment = document.createDocumentFragment();
      comments.forEach((comment) => fragment.append(renderComment(comment)));
      list.append(fragment);
      renderCount();
    }

    function validate() {
      let valid = true;

      if (!nameInput.value.trim()) {
        nameError.textContent = 'Please enter your name.';
        nameInput.setAttribute('aria-invalid', 'true');
        nameInput.setAttribute('aria-describedby', nameError.id);
        valid = false;
      } else {
        nameError.textContent = '';
        nameInput.removeAttribute('aria-invalid');
        nameInput.removeAttribute('aria-describedby');
      }

      if (!bodyInput.value.trim()) {
        bodyError.textContent = 'Please write a comment before posting.';
        bodyInput.setAttribute('aria-invalid', 'true');
        bodyInput.setAttribute('aria-describedby', bodyError.id);
        valid = false;
      } else {
        bodyError.textContent = '';
        bodyInput.removeAttribute('aria-invalid');
        bodyInput.removeAttribute('aria-describedby');
      }

      return valid;
    }

    // Clear the error as soon as the reader starts fixing it.
    nameInput.addEventListener('input', () => {
      if (nameInput.value.trim()) {
        nameError.textContent = '';
        nameInput.removeAttribute('aria-invalid');
      }
    });
    bodyInput.addEventListener('input', () => {
      if (bodyInput.value.trim()) {
        bodyError.textContent = '';
        bodyInput.removeAttribute('aria-invalid');
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      formStatus.textContent = '';

      if (!validate()) {
        (nameError.textContent ? nameInput : bodyInput).focus();
        return;
      }

      const author = nameInput.value.trim().replace(/\s+/g, ' ');
      const body = bodyInput.value.trim();

      submit.disabled = true;
      submit.textContent = 'Posting...';

      // Optimistic insert so the comment appears immediately. clientId keeps a
      // retried server write idempotent without storing the comment locally.
      const clientId = newClientId();
      const optimistic = {
        id: `pending-${Date.now()}`,
        author,
        body,
        clientId,
        createdAt: new Date().toISOString()
      };
      comments = [optimistic, ...comments];
      const optimisticNode = renderComment(optimistic, { isNew: true });
      list.prepend(optimisticNode);
      renderCount();

      try {
        const saved = await sendComment(slug, { author, body, clientId });
        // Swap the placeholder for the stored record (real id, server timestamp).
        comments = comments.map((item) => (item.id === optimistic.id ? saved : item));
        optimisticNode.replaceWith(renderComment(saved, { isNew: true }));
        bodyInput.value = '';
        formStatus.textContent = 'Comment posted. Thanks for joining the conversation.';
      } catch (error) {
        comments = comments.filter((item) => item.id !== optimistic.id);
        optimisticNode.remove();
        renderCount();
        formStatus.textContent = 'Could not post your comment. Please try again.';
      } finally {
        submit.disabled = false;
        submit.textContent = 'Post comment';
      }
    });

    return {
      element: section,
      hydrate(initial) {
        comments = Array.isArray(initial) ? initial : [];
        renderAll();
      },
      setUnavailable(message) {
        nameInput.disabled = true;
        bodyInput.disabled = true;
        submit.disabled = true;
        formStatus.textContent = message;
      }
    };
  }

  /* ------------------------------ read tracking ---------------------------- */

  /**
   * Counts an article read once the reader has actually engaged with the page.
   *
   * A hit on load would count bounces and prefetches as reads, so the beacon
   * waits for a real signal of attention: either scrolling past the top of the
   * article, or spending long enough on the page to have read something. It
   * fires at most once per page load, and the server collapses repeats by the
   * same anonymous reader on the same day.
   */
  const VIEW_DWELL_MS = 12000;
  const VIEW_SCROLL_RATIO = 0.25;

  function trackRead(slug) {
    if (!slug) return () => {};

    let sent = false;
    let timer = null;

    async function send() {
      if (sent) return;
      sent = true;
      cleanup();
      try {
        await apiRequest(`/articles/${encodeURIComponent(slug)}/views`, {
          method: 'POST',
          body: JSON.stringify({ voterId: voterId() })
        });
      } catch (error) {
        // A missed read is not worth surfacing to the reader.
      }
    }

    function onScroll() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      // A page too short to scroll counts on the dwell timer instead.
      if (scrollable <= 0) return;
      if (window.scrollY / scrollable >= VIEW_SCROLL_RATIO) send();
    }

    function cleanup() {
      window.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
      timer = null;
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    timer = setTimeout(send, VIEW_DWELL_MS);
    return cleanup;
  }

  /* -------------------------------- mount ---------------------------------- */

  /**
   * Renders the reactions and comments widgets into `container`.
   * `slug` identifies the article; any stable string works.
   */
  async function mount(container, { slug } = {}) {
    if (!container || !slug) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'engagement';

    const reactions = buildReactions(slug);
    const comments = buildComments(slug);
    wrapper.append(reactions.element, comments.element);
    container.append(wrapper);

    try {
      const data = await getEngagement(slug);
      reactions.paint(data.reactions);
      comments.hydrate(data.comments);
    } catch (error) {
      reactions.paint({ likes: 0, dislikes: 0, mine: null });
      comments.hydrate([]);
      const message = 'Live engagement is temporarily unavailable. Please try again later.';
      reactions.setUnavailable(message);
      comments.setUnavailable(message);
    }

    // Read analytics also uses the shared API; failures are intentionally
    // silent because they should never interrupt the article experience.
    trackRead(slug);
    return wrapper;
  }

  return { mount, voterId, getEngagement, sendReaction, sendComment, newClientId, trackRead };
})();
