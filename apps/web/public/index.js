// Homepage experience: hero slider, searchable article cards, category filters and pagination.
// All mutable content is loaded from the live Sholynk API and SQLite database.
(() => {
  // Populated from the CMS before first render.
  let heroSlides = [];
  let articles = [];
  let categories = ['All'];
  let contentRequestId = 0;

  const state = {
    currentSlide: 0,
    heroTimer: null,
    isPaused: false,
    currentPage: 1,
    cardsPerPage: 10,
    totalArticles: 0,
    query: '',
    category: 'All',
    observer: null
  };

  const selectors = {
    heroSection: document.querySelector('.hero-section'),
    searchInput: document.getElementById('searchInput'),
    cardsContainer: document.getElementById('cardsContainer'),
    prevPageBtn: document.getElementById('prevPage'),
    nextPageBtn: document.getElementById('nextPage'),
    paginationNumbers: document.getElementById('paginationNumbers'),
    categoryFilters: document.getElementById('categoryFilters'),
    clearSearch: document.getElementById('clearSearch'),
    resultsCount: document.getElementById('resultsCount')
  };

  function createIcon(className) {
    const icon = document.createElement('i');
    icon.className = className;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function formatCardDate(value) {
    if (!value) return '';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value);
    if (Number.isNaN(parsed.valueOf())) return value;
    return parsed.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...(dateOnly ? { timeZone: 'UTC' } : {})
    });
  }

  function getRequestedCategory() {
    return new URLSearchParams(window.location.search).get('category') || '';
  }


  function getArticleHeroSlidesForCategory(category) {
    return articles
      .filter((article) => article.category === category)
      .slice(0, 5)
      .map(toHeroSlide);
  }

  function buildHeroSlides(heroArticles, requestedCategory) {
    if (requestedCategory) {
      const articleSlides = getArticleHeroSlidesForCategory(requestedCategory);
      if (articleSlides.length) return articleSlides;
    }

    return (heroArticles.length ? heroArticles : articles.slice(0, 4)).map(toHeroSlide);
  }

  function initHero() {
    const { heroSection } = selectors;
    if (!heroSection) return;

    heroSlides.forEach((slide, index) => {
      const slideEl = document.createElement('section');
      slideEl.className = `hero-slide${index === 0 ? ' active' : ''}`;
      slideEl.setAttribute('aria-hidden', index === 0 ? 'false' : 'true');
      slideEl.setAttribute('aria-label', `Featured story ${index + 1} of ${heroSlides.length}`);

      const image = document.createElement('img');
      image.src = slide.img;
      image.alt = slide.alt || '';
      image.decoding = 'async';
      image.loading = index === 0 ? 'eager' : 'lazy';
      image.addEventListener('error', () => {
        image.src = 'assets/brand/hero-fallback.jpeg';
      }, { once: true });

      const content = document.createElement('div');
      content.className = 'hero-content';

      const category = document.createElement('span');
      category.className = 'hero-kicker';
      category.textContent = slide.category;

      // Each slide is a featured story, not the page subject: the document's
      // single H1 lives in the hero section itself. Five competing H1s would
      // leave assistive technology and crawlers with no clear page title.
      const title = document.createElement('h2');
      title.textContent = slide.title;

      const description = document.createElement('p');
      description.textContent = slide.description;

      const link = document.createElement('a');
      const isTopicLink = /(?:^|\/)index\.html\?category=/i.test(slide.readMoreLink || '');
      link.href = slide.readMoreLink;
      link.setAttribute(
        'aria-label',
        isTopicLink
          ? `Browse more ${slide.category} articles`
          : `Read more about ${slide.title}`
      );
      link.textContent = isTopicLink ? `Browse ${slide.category}` : 'Read the story';
      link.append(createIcon('fas fa-arrow-right'));

      content.append(category, title, description, link);
      slideEl.append(image, content);
      heroSection.append(slideEl);
    });

    const controls = document.createElement('div');
    controls.className = 'hero-controls';

    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'hero-control';
    previous.setAttribute('aria-label', 'Show previous featured story');
    previous.append(createIcon('fas fa-chevron-left'));

    const pause = document.createElement('button');
    pause.type = 'button';
    pause.className = 'hero-control';
    pause.setAttribute('aria-label', 'Pause featured story autoplay');
    pause.append(createIcon('fas fa-pause'));

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'hero-control';
    next.setAttribute('aria-label', 'Show next featured story');
    next.append(createIcon('fas fa-chevron-right'));

    const dots = document.createElement('div');
    dots.className = 'hero-dots';
    heroSlides.forEach((slide, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `hero-dot${index === 0 ? ' active' : ''}`;
      dot.textContent = `${index + 1}`;
      dot.setAttribute('aria-label', `Show featured story: ${slide.title}`);
      dot.addEventListener('click', () => {
        showSlide(index);
        restartHeroTimer();
      });
      dots.append(dot);
    });

    previous.addEventListener('click', () => {
      showSlide(state.currentSlide - 1);
      restartHeroTimer();
    });
    next.addEventListener('click', () => {
      showSlide(state.currentSlide + 1);
      restartHeroTimer();
    });
    pause.addEventListener('click', () => {
      state.isPaused = !state.isPaused;
      pause.setAttribute('aria-label', state.isPaused ? 'Resume featured story autoplay' : 'Pause featured story autoplay');
      pause.innerHTML = '';
      pause.append(createIcon(state.isPaused ? 'fas fa-play' : 'fas fa-pause'));
      restartHeroTimer();
    });

    controls.append(previous, pause, next, dots);
    heroSection.append(controls);
    startHeroTimer();
  }

  function showSlide(nextIndex) {
    const slides = selectors.heroSection?.querySelectorAll('.hero-slide') || [];
    const dots = selectors.heroSection?.querySelectorAll('.hero-dot') || [];
    if (!slides.length) return;

    state.currentSlide = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      const isActive = index === state.currentSlide;
      slide.classList.toggle('active', isActive);
      slide.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });
    dots.forEach((dot, index) => dot.classList.toggle('active', index === state.currentSlide));
  }

  function startHeroTimer() {
    if (state.isPaused) return;
    state.heroTimer = window.setInterval(() => showSlide(state.currentSlide + 1), 6500);
  }

  function restartHeroTimer() {
    window.clearInterval(state.heroTimer);
    startHeroTimer();
  }

  function getCategories() {
    return categories;
  }

  function initCategoryFilters() {
    const { categoryFilters } = selectors;
    if (!categoryFilters) return;

    const requestedCategory = new URLSearchParams(window.location.search).get('category');
    if (requestedCategory && getCategories().includes(requestedCategory)) {
      state.category = requestedCategory;
    }

    getCategories().forEach((category) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `category-chip${category === state.category ? ' active' : ''}`;
      chip.dataset.category = category;
      chip.textContent = category;
      chip.addEventListener('click', () => {
        state.category = category;
        state.currentPage = 1;
        updateCategoryUrl(category);
        renderCategoryFilters();
        refreshArticles();
      });
      categoryFilters.append(chip);
    });
  }

  function renderCategoryFilters() {
    selectors.categoryFilters?.querySelectorAll('.category-chip').forEach((chip) => {
      const isActive = chip.dataset.category === state.category;
      chip.classList.toggle('active', isActive);
      chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function updateCategoryUrl(category) {
    const url = new URL(window.location.href);
    if (category === 'All') {
      url.searchParams.delete('category');
    } else {
      url.searchParams.set('category', category);
    }
    window.history.replaceState({}, '', url.toString());
  }

  function getFilteredArticles() {
    // `articles` is already the current SQLite query result. Keeping this
    // helper isolates pagination from transport details without reintroducing
    // a browser-only search index.
    return articles;
  }

  /* Aspect-ratio-aware classification for the bento-style feed (.bento-feed).
     Tiles are classified into 'tall', 'square', 'landscape', or 'wide' based on
     the real aspect ratio of their image rather than index/cycle alone. The
     class is kept for styling and analytics hooks, but it no longer widens a
     card: every shape occupies a single column at every breakpoint so cards
     never span across their neighbours on tablet or desktop layouts. */

  function classifyAspectRatio(ratio) {
    if (!ratio || !isFinite(ratio)) return 'square';
    if (ratio < 0.9) return 'tall';
    if (ratio < 1.35) return 'square';
    if (ratio < 1.8) return 'landscape';
    return 'wide';
  }

  function applyTileShape(card, shape) {
    card.classList.remove('card--tall', 'card--square', 'card--landscape', 'card--wide');
    card.classList.add(`card--${shape}`);
    card.dataset.shape = shape;
    scheduleMosaicBalance();
  }

  /* Uniform-width mosaic.

     Every breakpoint in styles.css now gives each card exactly one column, so
     each row always adds up to the column count on its own and there is
     nothing left to pack. Earlier versions widened tiles to fill leftover
     space, which is what produced the stretched, banner-like cards on tablet
     widths (three- and four-column layouts, e.g. iPad portrait and landscape).

     All this pass has to do now is undo any inline spans a previous version
     left behind and put the cards back in published order, so the CSS grid is
     the single source of truth for card widths at every screen size. */

  let mosaicBalanceHandle = null;

  function scheduleMosaicBalance() {
    if (mosaicBalanceHandle) return;
    mosaicBalanceHandle = window.requestAnimationFrame(() => {
      mosaicBalanceHandle = null;
      balanceMosaic();
    });
  }

  function balanceMosaic() {
    const grid = selectors.cardsContainer;
    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll('.card'))
      .sort((a, b) => Number(a.dataset.index || 0) - Number(b.dataset.index || 0));
    if (!cards.length) return;

    cards.forEach((card) => {
      card.style.removeProperty('grid-column');
      card.style.removeProperty('grid-row');
      grid.append(card);
    });
  }

  function getKnownAspectRatio(article) {
    if (article.width && article.height && article.height > 0) {
      return article.width / article.height;
    }
    if (article.img) {
      try {
        const url = new URL(article.img, window.location.href);
        const w = parseFloat(url.searchParams.get('w'));
        const h = parseFloat(url.searchParams.get('h'));
        if (w && h && !isNaN(w) && !isNaN(h) && h > 0) {
          return w / h;
        }
      } catch (e) {
        // ignore invalid url
      }
    }
    return null;
  }

  function createCard(article, index) {
    const hasLongForm = Boolean(article.hasBody || (article.body && article.body.trim()));
    const hasExternalArticle = /^https?:\/\//i.test(article.externalLink || '');
    const hasDestination = hasLongForm || hasExternalArticle;
    const card = document.createElement(hasDestination ? 'a' : 'article');
    const hasImage = Boolean(article.img);
    const isWeb3NoImage = article.category === 'Web 3' && !hasImage;

    const knownRatio = getKnownAspectRatio(article);
    const initialShape = knownRatio ? classifyAspectRatio(knownRatio) : (hasImage ? 'landscape' : 'square');

    if (hasDestination) card.href = article.link;
    card.className = `card card--${initialShape}${isWeb3NoImage ? ' web3-dark' : ''}${hasImage ? '' : ' card--no-media'}${hasDestination ? '' : ' card--pending'}`;
    if (hasDestination) card.setAttribute('role', 'article');
    card.dataset.title = article.title;
    card.dataset.category = article.category;
    card.dataset.index = index.toString();
    card.dataset.shape = initialShape;

    if (hasImage) {
      const media = document.createElement('div');
      media.className = 'card-media';
      const image = document.createElement('img');
      image.src = article.img;
      image.alt = article.alt || '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.width = 900;
      image.height = 600;

      const updateShapeFromNaturalSize = () => {
        if (image.naturalWidth && image.naturalHeight) {
          const ratio = image.naturalWidth / image.naturalHeight;
          const actualShape = classifyAspectRatio(ratio);
          applyTileShape(card, actualShape);
          card.dataset.aspectRatio = ratio.toFixed(2);
        }
      };

      if (image.complete && image.naturalWidth) {
        updateShapeFromNaturalSize();
      } else {
        image.addEventListener('load', updateShapeFromNaturalSize, { once: true });
      }

      image.addEventListener('error', () => {
        image.src = 'assets/brand/hero-fallback.jpeg';
        image.addEventListener('load', updateShapeFromNaturalSize, { once: true });
      }, { once: true });

      media.append(image);
      card.append(media);
    }

    const body = document.createElement('div');
    body.className = 'card-body';

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const category = document.createElement('span');
    category.className = 'category-label';
    category.textContent = article.category;

    const date = document.createElement('span');
    date.textContent = formatCardDate(article.date);

    meta.append(category, date);

    const title = document.createElement('h3');
    title.textContent = article.title;

    const description = document.createElement('p');
    description.textContent = article.description;

    const footer = document.createElement('div');
    footer.className = 'card-footer';
    const time = document.createElement('span');
    time.textContent = hasDestination ? article.readingTime : '';
    const cta = document.createElement('span');
    cta.textContent = hasDestination ? 'Read more' : 'Full article coming soon';
    cta.append(createIcon(hasDestination ? 'fas fa-arrow-right' : 'fas fa-clock'));
    footer.append(time, cta);

    body.append(meta, title, description, footer);
    card.append(body);
    return card;
  }

  function renderCards() {
    const { cardsContainer } = selectors;
    if (!cardsContainer) return;

    const filteredArticles = getFilteredArticles();
    const totalPages = Math.max(1, Math.ceil(state.totalArticles / state.cardsPerPage));
    state.currentPage = Math.min(state.currentPage, totalPages);

    const pageArticles = filteredArticles;

    cardsContainer.innerHTML = '';
    if (!pageArticles.length) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      const title = document.createElement('h3');
      title.textContent = 'No matching articles yet';
      const description = document.createElement('p');
      description.textContent = 'Try a different keyword or choose another category to keep exploring Sholynk.';
      emptyState.append(title, description);
      cardsContainer.append(emptyState);
    } else {
      const fragment = document.createDocumentFragment();
      pageArticles.forEach((article, index) => fragment.append(createCard(article, index)));
      cardsContainer.append(fragment);
    }

    updateResultsCount(state.totalArticles);
    renderPagination(totalPages);
    observeCards();
    balanceMosaic();
  }

  function updateResultsCount(count) {
    if (!selectors.resultsCount) return;
    const articleWord = count === 1 ? 'article' : 'articles';
    const categoryText = state.category === 'All' ? 'all categories' : state.category;
    selectors.resultsCount.textContent = `${count} ${articleWord} in ${categoryText}`;
  }

  function renderPagination(totalPages) {
    const { prevPageBtn, nextPageBtn, paginationNumbers } = selectors;
    if (!prevPageBtn || !nextPageBtn || !paginationNumbers) return;

    prevPageBtn.disabled = state.currentPage <= 1;
    nextPageBtn.disabled = state.currentPage >= totalPages;
    paginationNumbers.innerHTML = '';

    if (totalPages <= 1) return;

    for (let page = 1; page <= totalPages; page += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = page.toString();
      button.className = page === state.currentPage ? 'active' : '';
      button.setAttribute('aria-label', `Go to articles page ${page}`);
      if (page === state.currentPage) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', () => {
        state.currentPage = page;
        refreshArticles({ preservePage: true });
        selectors.cardsContainer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      paginationNumbers.append(button);
    }
  }

  function observeCards() {
    if (state.observer) state.observer.disconnect();
    const cards = document.querySelectorAll('.card');
    if (!('IntersectionObserver' in window)) {
      cards.forEach((card) => card.classList.add('visible'));
      return;
    }

    state.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          state.observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });

    cards.forEach((card) => state.observer.observe(card));
  }

  async function refreshArticles({ preservePage = false } = {}) {
    if (!preservePage) state.currentPage = 1;
    const requestId = ++contentRequestId;
    selectors.cardsContainer?.setAttribute('aria-busy', 'true');
    try {
      const next = await window.SholynkCMS.getArticles({
        status: 'published',
        category: state.category === 'All' ? undefined : state.category,
        q: state.query.trim() || undefined,
        limit: state.cardsPerPage,
        offset: (state.currentPage - 1) * state.cardsPerPage
      });
      if (requestId !== contentRequestId) return;
      articles = next;
      state.totalArticles = next.pagination?.total ?? next.length;
      renderCards();
    } catch (error) {
      if (requestId !== contentRequestId) return;
      console.error('Unable to search live content', error);
      renderLoadError();
    } finally {
      if (requestId === contentRequestId) {
        selectors.cardsContainer?.setAttribute('aria-busy', 'false');
      }
    }
  }

  function initSearch() {
    const { searchInput, clearSearch, prevPageBtn, nextPageBtn } = selectors;
    let searchTimer = null;
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        state.query = event.target.value;
        state.currentPage = 1;
        if (clearSearch) clearSearch.hidden = state.query.length === 0;
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(refreshArticles, 250);
      });
    }

    clearSearch?.addEventListener('click', () => {
      state.query = '';
      searchInput.value = '';
      clearSearch.hidden = true;
      state.currentPage = 1;
      window.clearTimeout(searchTimer);
      refreshArticles();
      searchInput.focus();
    });

    prevPageBtn?.addEventListener('click', () => {
      if (state.currentPage > 1) {
        state.currentPage -= 1;
        refreshArticles({ preservePage: true });
        selectors.cardsContainer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    nextPageBtn?.addEventListener('click', () => {
      const totalPages = Math.max(1, Math.ceil(state.totalArticles / state.cardsPerPage));
      if (state.currentPage < totalPages) {
        state.currentPage += 1;
        refreshArticles({ preservePage: true });
        selectors.cardsContainer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    document.querySelector('.search-card')?.addEventListener('submit', (event) => {
      event.preventDefault();
      window.clearTimeout(searchTimer);
      refreshArticles();
    });
  }

  function toHeroSlide(article) {
    return {
      category: article.category,
      title: article.title,
      description: article.description,
      img: article.img,
      alt: article.alt || '',
      readMoreLink: article.link
    };
  }

  function renderLoadError() {
    const { cardsContainer } = selectors;
    if (!cardsContainer) return;
    cardsContainer.innerHTML = '';
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    const title = document.createElement('h3');
    title.textContent = 'Content is unavailable right now';
    const description = document.createElement('p');
    description.textContent = 'We could not reach the Sholynk content service. Please refresh in a moment.';
    emptyState.append(title, description);
    cardsContainer.append(emptyState);
  }

  async function loadContent() {
    const requestedCategory = getRequestedCategory();
    const [categoryList, heroArticles, visibleArticles] = await Promise.all([
      window.SholynkCMS.getCategories(),
      window.SholynkCMS.getArticles({ status: 'published', hero: true, limit: 8 }),
      window.SholynkCMS.getArticles({
        status: 'published',
        category: requestedCategory || undefined,
        limit: state.cardsPerPage,
        offset: 0
      })
    ]);
    categories = ['All', ...categoryList.filter(Boolean)];
    const knownCategory = Boolean(requestedCategory && categories.includes(requestedCategory));
    if (knownCategory) state.category = requestedCategory;
    articles = knownCategory || !requestedCategory
      ? visibleArticles
      : await window.SholynkCMS.getArticles({ status: 'published', limit: state.cardsPerPage, offset: 0 });
    state.totalArticles = articles.pagination?.total ?? articles.length;
    heroSlides = buildHeroSlides(heroArticles, knownCategory ? requestedCategory : '');
  }

  async function applySettings() {
    try {
      const settings = await window.SholynkCMS.getSettings();
      if (settings.siteTitle) document.title = settings.siteTitle;
      const metaDescription = document.querySelector('meta[name="description"]');
      if (settings.siteDescription && metaDescription) {
        metaDescription.setAttribute('content', settings.siteDescription);
      }
      const tagline = document.getElementById('discover-title');
      if (settings.homeTagline && tagline) tagline.textContent = settings.homeTagline;
    } catch (error) {
      console.warn('Unable to apply CMS settings', error);
    }
  }

  async function init() {
    try {
      await loadContent();
    } catch (error) {
      console.error('Unable to load CMS content', error);
      renderLoadError();
      return;
    }

    initHero();
    initCategoryFilters();
    initSearch();
    renderCategoryFilters();
    renderCards();
    applySettings();

    // Column count changes at each breakpoint, so the packing has to be
    // recalculated when the viewport is resized or the device is rotated.
    window.addEventListener('resize', scheduleMosaicBalance, { passive: true });
    window.addEventListener('orientationchange', scheduleMosaicBalance, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
