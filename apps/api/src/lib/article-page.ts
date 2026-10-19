/**
 * Sholynk Tech — server-side article page renderer.
 *
 * Ported from the legacy CMS renderer (cms/lib/article-page.js). Every call
 * receives current D1 records and produces the response document for one clean
 * article URL (`/articles/<slug>/`). Nothing is written to storage: the
 * database remains the sole public runtime content source.
 *
 * The presentation shell is imported as text from `article-shell.html`, which a
 * unit test keeps byte-identical to `apps/web/public/article.html` — one
 * document, two delivery paths (SSR at the edge, static fallback on disk).
 */
import shellSource from './article-shell.html';
import {
  SITE_ROOT_PREFIX,
  absoluteUrl,
  addIntrinsicImageSizes,
  articlePageUrl,
  escapeHtml,
  renderMarkdown,
  safeJson,
  siteUrl,
} from './markdown.js';

/* -------------------------------------------------------------------------- */
/* Input shapes (structural — the repositories produce exactly these)          */
/* -------------------------------------------------------------------------- */

export interface RenderableArticle {
  slug: string;
  title: string;
  category: string;
  subcategory?: string;
  contentType?: string;
  description: string;
  hook?: string;
  directAnswer?: string;
  keyTakeaways?: string[];
  faqs?: { question: string; answer: string }[];
  relatedSlugs?: string[];
  tags?: string[];
  body: string;
  hasBody?: boolean;
  img: string;
  alt: string;
  author: string;
  authorSlug?: string;
  date: string;
  readingTime?: string;
  status: string;
  featured?: boolean;
  externalLink?: string | null;
  canonicalUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  updatedAt?: string | null;
  sources?: RenderableSource[];
}

export interface RenderableSource {
  title: string;
  publisher?: string;
  author?: string;
  publishedAt?: string;
  url: string;
  type?: string;
  doi?: string;
  accessedAt?: string;
  supports?: string;
}

export interface RenderableAuthor {
  slug?: string;
  name?: string;
  bio?: string;
  role?: string;
  image?: string;
  imageAlt?: string;
  profileUrl?: string;
  socialLinks?: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* Small renderers                                                             */
/* -------------------------------------------------------------------------- */

export function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

export function renderToc(bodyHtml: string): string {
  const headings = [...bodyHtml.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)];
  if (headings.length < 3) return '';
  const items = headings
    .map((heading, index) => {
      const id = escapeHtml(heading[1]!);
      const text = escapeHtml(heading[2]!.replace(/<[^>]*>/g, ''));
      return `<li><a href="#${id}"${index === 0 ? ' aria-current="location"' : ''}><span>${text}</span></a></li>`;
    })
    .join('');
  return `<details class="article-toc" open><summary><span><small>Navigate</small>In this article</span><i class="fas fa-chevron-down" aria-hidden="true"></i></summary><nav aria-label="Table of contents"><ol>${items}</ol></nav></details>`;
}

export function renderAuthorCard(author: ResolvedAuthor, variant: 'rail' | 'inline' = 'rail'): string {
  const hasImage = Boolean(author.image);
  const initials =
    (author.name || 'A')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || 'A';
  const media = hasImage
    ? `<div class="article-author-media"><img src="${escapeHtml(
        /^https?:\/\//i.test(author.image!) ? author.image! : articlePageUrl(author.image!),
      )}" alt="${escapeHtml(author.imageAlt || `Photo of ${author.name}`)}" loading="lazy" decoding="async"/></div>`
    : `<div class="article-author-media"><div class="article-author-avatar" aria-hidden="true">${escapeHtml(initials)}</div></div>`;
  // The role line is deliberately not rendered: the bio already states what the
  // author does, so printing both repeats the same sentence twice on the card.
  const bio = author.bio ? `<p class="article-author-bio">${escapeHtml(author.bio)}</p>` : '';
  const link = author.profileUrl
    ? `<a class="article-author-link" href="${escapeHtml(author.id)}" target="_blank" rel="noopener noreferrer">View full profile <i class="fas fa-arrow-right" aria-hidden="true"></i></a>`
    : '';
  const social = Object.entries(author.socialLinks || {}).filter(([, url]) => /^https:\/\//i.test(url))
    .map(([label, url]) => `<a class="article-author-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`).join(' ');
  const classes = ['article-author-card', `article-author-card--${variant}`].join(' ');
  return `<aside class="${classes}" aria-label="About ${escapeHtml(author.name || 'the author')}">${media}<div class="article-author-body"><p class="eyebrow">Written by</p><h3>${escapeHtml(
    author.name || 'Sholynk Editorial',
  )}</h3>${bio}${link}${social ? `<nav aria-label="Author social links">${social}</nav>` : ''}</div></aside>`;
}

/**
 * The shared presentation shell lives at the site root. A clean article route
 * is two URL segments deeper, so local assets, navigation and form actions are
 * rewritten to point back to the application root.
 */
export function localiseShell(shell: string): string {
  return shell.replace(/\b(href|src|action)="([^"]+)"/g, (match, attribute: string, value: string) => {
    if (/^(?:https?:|mailto:|tel:|data:|#|\/)/i.test(value)) return match;
    return `${attribute}="${SITE_ROOT_PREFIX}${value}"`;
  });
}

function renderList(items: string[] | undefined, className: string): string {
  if (!Array.isArray(items) || !items.length) return '';
  return `<ul class="${className}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export function renderFaqs(faqs: RenderableArticle['faqs']): string {
  if (!Array.isArray(faqs) || !faqs.length) return '';
  return `<section class="article-faq" aria-labelledby="faq-heading"><h2 id="faq-heading">Frequently asked questions</h2>${faqs
    .map(
      (faq) =>
        `<details><summary>${escapeHtml(faq.question)}</summary><p>${escapeHtml(faq.answer)}</p></details>`,
    )
    .join('')}</section>`;
}

export function renderSources(sources: RenderableSource[] | undefined): string {
  if (!Array.isArray(sources) || !sources.length) return '';
  return `<section class="article-sources" aria-labelledby="sources-heading"><h2 id="sources-heading">Sources</h2><ol>${sources
    .map((source) => {
      const details = [source.author, source.publisher, source.publishedAt]
        .filter(Boolean)
        .map((part) => escapeHtml(String(part)))
        .join(', ');
      return `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
        source.title,
      )}</a>${details ? ` — ${details}` : ''}${
        source.supports ? `<span>Supports: ${escapeHtml(source.supports)}</span>` : ''
      }</li>`;
    })
    .join('')}</ol></section>`;
}

function renderHero(article: RenderableArticle): string {
  if (!article.img) return '';
  const original = /^https?:\/\//i.test(article.img) ? article.img : articlePageUrl(article.img);
  return `<figure class="article-hero"><div class="article-hero-media"><img src="${escapeHtml(
    original,
  )}" alt="${escapeHtml(article.alt || article.title)}" decoding="async" fetchpriority="high" /></div>${
    article.alt ? `<figcaption>${escapeHtml(article.alt)}</figcaption>` : ''
  }</figure>`;
}

/** Explicit related slugs first, then same-category stories, max four. */
export function relatedFor(article: RenderableArticle, allArticles: RenderableArticle[]): RenderableArticle[] {
  const explicit = Array.isArray(article.relatedSlugs) ? article.relatedSlugs : [];
  const bySlug = new Map(allArticles.map((item) => [item.slug, item]));
  const chosen = explicit
    .map((slug) => bySlug.get(slug))
    .filter(
      (item): item is RenderableArticle =>
        Boolean(item) && Boolean(item!.hasBody || item!.body || /^https?:\/\//i.test(item!.externalLink || '')),
    );
  for (const item of allArticles) {
    if (chosen.length >= 4) break;
    if (
      item.slug !== article.slug &&
      (item.hasBody || Boolean(item.body)) &&
      !item.externalLink &&
      item.category === article.category &&
      !chosen.some((entry) => entry.slug === item.slug)
    ) {
      chosen.push(item);
    }
  }
  return chosen.slice(0, 4);
}

function articleLink(article: RenderableArticle): string {
  if (article.externalLink) return articlePageUrl(article.externalLink);
  return articlePageUrl(`articles/${encodeURIComponent(article.slug)}/`);
}

export function renderRelated(article: RenderableArticle, allArticles: RenderableArticle[]): string {
  const related = relatedFor(article, allArticles);
  if (!related.length) return '';
  return `<section class="related-section" id="relatedSection" aria-labelledby="related-title"><div class="related-heading"><div><p class="eyebrow">Continue exploring</p><h2 class="section-heading" id="related-title">Read next</h2></div><a class="related-all-link" href="${SITE_ROOT_PREFIX}index.html">View all stories <i class="fas fa-arrow-right" aria-hidden="true"></i></a></div><div class="related-grid" id="relatedGrid">${related
    .map((item) => {
      const link = articleLink(item);
      const external = /^https?:\/\//i.test(link);
      const image = item.img
        ? `<div class="related-card-media"><img src="${escapeHtml(
            /^https?:\/\//i.test(item.img) ? item.img : articlePageUrl(item.img),
          )}" alt="${escapeHtml(item.alt || item.title)}" loading="lazy" decoding="async" /></div>`
        : '';
      return `<a class="related-card" href="${escapeHtml(link)}"${
        external ? ' target="_blank" rel="noopener noreferrer"' : ''
      }>${image}<div class="related-card-body"><span class="category-label">${escapeHtml(
        item.category,
      )}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(
        item.description,
      )}</p><span class="related-card-cta">Read article <i class="fas fa-arrow-right" aria-hidden="true"></i></span></div></a>`;
    })
    .join('')}</div></section>`;
}

/* -------------------------------------------------------------------------- */
/* Author resolution + structured data                                         */
/* -------------------------------------------------------------------------- */

export interface ResolvedAuthor extends RenderableAuthor {
  slug: string;
  name: string;
  /** Absolute profile URL, including the #slug fragment. */
  id: string;
  profileUrl: string;
}

export function resolveAuthor(
  article: RenderableArticle,
  authors: RenderableAuthor[],
  origin: string,
): ResolvedAuthor {
  const entity = (authors || []).find((author) => author.slug === article.authorSlug) ?? ({} as RenderableAuthor);
  const slug = entity.slug || article.authorSlug || 'oluwashola-busari';
  const profileUrl = entity.profileUrl || !entity.slug ? absoluteUrl(entity.profileUrl || 'about.html', origin) : '';
  const id = profileUrl ? (profileUrl.includes('#') ? profileUrl : `${profileUrl}#${encodeURIComponent(slug)}`)
    : `${absoluteUrl('/', origin)}#author-${encodeURIComponent(slug)}`;
  return {
    ...entity,
    slug,
    name: entity.name || article.author || 'Oluwashola Busari',
    profileUrl,
    id,
  };
}

export function schemaFor(
  article: RenderableArticle,
  canonical: string,
  author: ResolvedAuthor,
  origin: string,
): Record<string, unknown> {
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'Article',
      '@id': `${canonical}#article`,
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      headline: article.title,
      description: article.seoDescription || article.description,
      image: article.img ? [absoluteUrl(article.img, origin)] : undefined,
      datePublished: article.date,
      dateModified: article.updatedAt ? `${String(article.updatedAt).replace(' ', 'T')}Z` : article.date,
      articleSection: article.category,
      keywords: Array.isArray(article.tags) ? article.tags.join(', ') : undefined,
      author: {
        '@type': 'Person',
        '@id': author.id,
        name: author.name,
        url: author.profileUrl || undefined,
        jobTitle: author.role || undefined,
        description: author.bio || undefined,
        image: author.image ? absoluteUrl(author.image, origin) : undefined,
      },
      publisher: {
        '@type': 'Organization',
        '@id': `${siteUrl('/', origin)}#organization`,
        name: 'Sholynk Technology',
        url: siteUrl('/', origin),
        logo: { '@type': 'ImageObject', url: absoluteUrl('assets/brand/page_logo.png', origin) },
      },
      citation: article.sources?.length
        ? article.sources.map((source) => source.url).filter(Boolean)
        : undefined,
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl('/', origin) },
        {
          '@type': 'ListItem',
          position: 2,
          name: article.category,
          item: siteUrl(`/?category=${encodeURIComponent(article.category)}`, origin),
        },
        { '@type': 'ListItem', position: 3, name: article.title, item: canonical },
      ],
    },
  ];
  if (article.faqs?.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntity: article.faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/* -------------------------------------------------------------------------- */
/* Head + article markup                                                       */
/* -------------------------------------------------------------------------- */

export function renderHead(
  article: RenderableArticle,
  canonical: string,
  author: ResolvedAuthor,
  origin: string,
): string {
  const title = article.seoTitle || `${article.title} | Sholynk Tech`;
  const description = article.seoDescription || article.description;
  const image = article.img
    ? absoluteUrl(article.img, origin)
    : absoluteUrl('assets/brand/page_logo.png', origin);
  return `<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="author" content="${escapeHtml(author.name)}" />
    <meta name="theme-color" content="#000000" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Sholynk Tech" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="article:published_time" content="${escapeHtml(article.date)}" />
    <meta property="article:section" content="${escapeHtml(article.category)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    <link rel="shortcut icon" href="${SITE_ROOT_PREFIX}assets/brand/sholynk_icon.png" type="image/png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css" rel="stylesheet" />
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&amp;display=swap" rel="stylesheet" />
    <link href="${SITE_ROOT_PREFIX}styles.css" rel="stylesheet" />
    <script type="application/ld+json">${safeJson(schemaFor(article, canonical, author, origin))}</script>
  </head>`;
}

export function renderArticle(
  article: RenderableArticle,
  bodyHtml: string,
  canonical: string,
  author: ResolvedAuthor,
  origin: string,
): string {
  const quickAnswer = article.directAnswer
    ? `<aside class="article-answer" aria-labelledby="quick-answer-heading"><div class="article-callout-icon" aria-hidden="true"><i class="fas fa-bolt"></i></div><div><p class="eyebrow" id="quick-answer-heading">Quick answer</p><p>${escapeHtml(
        article.directAnswer,
      )}</p></div></aside>`
    : '';
  const takeaways = article.keyTakeaways?.length
    ? `<aside class="article-takeaways" aria-labelledby="takeaways-heading"><div class="article-callout-heading"><span class="article-callout-icon" aria-hidden="true"><i class="fas fa-check"></i></span><div><p class="eyebrow">The essentials</p><h2 id="takeaways-heading">Key takeaways</h2></div></div>${renderList(
        article.keyTakeaways,
        'takeaway-list',
      )}</aside>`
    : '';
  const toc = renderToc(bodyHtml);
  const shareText = encodeURIComponent(`${article.title} ${canonical}`);
  const shareUrl = encodeURIComponent(canonical);
  const localAuthorReference = author.id.startsWith(origin) ? author.id.slice(origin.length) : author.id;
  const authorHref = /^\//.test(localAuthorReference) ? articlePageUrl(localAuthorReference) : localAuthorReference;
  const contentType = article.contentType
    ? `<span aria-hidden="true">•</span><span>${escapeHtml(article.contentType)}</span>`
    : '';
  const share = `<section class="article-share" aria-labelledby="share-heading"><div class="article-share-copy"><p class="eyebrow">Worth sharing?</p><h2 id="share-heading">Pass this story on</h2></div><div class="article-share-actions"><a href="https://twitter.com/intent/tweet?text=${shareText}" target="_blank" rel="noopener noreferrer" aria-label="Share on X"><i class="fa-brands fa-x-twitter" aria-hidden="true"></i><span>X</span></a><a href="https://www.facebook.com/sharer/sharer.php?u=${shareUrl}" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook"><i class="fab fa-facebook-f" aria-hidden="true"></i><span>Facebook</span></a><a href="https://wa.me/?text=${shareText}" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp"><i class="fab fa-whatsapp" aria-hidden="true"></i><span>WhatsApp</span></a><button type="button" data-copy-article data-copy-url="${escapeHtml(
    canonical,
  )}" aria-label="Copy article link"><i class="fas fa-link" aria-hidden="true"></i><span>Copy link</span></button></div><p class="article-share-status" role="status" aria-live="polite"></p></section>`;

  const railAuthor = renderAuthorCard(author, 'rail');
  const inlineAuthor = renderAuthorCard(author, 'inline');
  return `<article class="article-page" id="articleRoot" data-server-rendered="true" data-slug="${escapeHtml(
    article.slug,
  )}" aria-busy="false">
    <div class="article-masthead">
      <nav class="article-breadcrumb" aria-label="Breadcrumb"><a href="${SITE_ROOT_PREFIX}index.html"><i class="fas fa-house" aria-hidden="true"></i><span>Home</span></a><i class="fas fa-chevron-right" aria-hidden="true"></i><a href="${SITE_ROOT_PREFIX}index.html?category=${encodeURIComponent(
        article.category,
      )}">${escapeHtml(article.category)}</a><i class="fas fa-chevron-right" aria-hidden="true"></i><span aria-current="page">${escapeHtml(
        article.title,
      )}</span></nav>
      <header class="article-header"><div class="article-kicker"><span class="category-label">${escapeHtml(
        article.category,
      )}</span>${contentType}<span aria-hidden="true">•</span><span>${escapeHtml(
        article.readingTime || 'Long read',
      )}</span></div><h1>${escapeHtml(article.title)}</h1><p class="article-standfirst">${escapeHtml(
        article.hook || article.description,
      )}</p><div class="article-meta"><span class="article-byline"><i class="fas fa-user" aria-hidden="true"></i><a href="${escapeHtml(
        authorHref,
      )}">${escapeHtml(author.name)}</a></span><span aria-hidden="true">•</span><time datetime="${escapeHtml(
        article.date,
      )}"><i class="fas fa-calendar" aria-hidden="true"></i>${escapeHtml(formatDate(article.date))}</time></div></header>
    </div>
    ${renderHero(article)}
    <div class="article-reading-layout">
      ${
        toc || railAuthor
          ? `<aside class="article-rail">${toc}${railAuthor}<a class="article-rail-home" href="${SITE_ROOT_PREFIX}index.html"><i class="fas fa-arrow-left" aria-hidden="true"></i><span>All stories</span></a></aside>`
          : ''
      }
      <div class="article-content">
        ${quickAnswer}
        ${takeaways}
        <div class="article-body">${bodyHtml}</div>
        ${renderFaqs(article.faqs)}
        ${renderSources(article.sources)}
        ${share}
        <div id="engagementRoot"></div>
        ${inlineAuthor}
        <nav class="article-end-nav" aria-label="Article navigation"><a class="article-back" href="${SITE_ROOT_PREFIX}index.html"><i class="fas fa-arrow-left" aria-hidden="true"></i><span>Back to all articles</span></a><a class="article-category-link" href="${SITE_ROOT_PREFIX}index.html?category=${encodeURIComponent(
          article.category,
        )}"><span>More in ${escapeHtml(article.category)}</span><i class="fas fa-arrow-right" aria-hidden="true"></i></a></nav>
      </div>
    </div>
  </article>`.replace(/^[ \t]+$/gm, '');
}

/* -------------------------------------------------------------------------- */
/* Page assembly                                                               */
/* -------------------------------------------------------------------------- */

export interface RenderArticlePageInput {
  article: RenderableArticle;
  articles?: RenderableArticle[];
  authors?: RenderableAuthor[];
  origin: string;
}

/**
 * Renders the full document for a clean article URL, or null when the article
 * must not be served as a page (unpublished, bodyless or external-link-only).
 */
export function renderArticlePage({
  article,
  articles = [],
  authors = [],
  origin,
}: RenderArticlePageInput): string | null {
  if (!article || article.status !== 'published' || !article.body || article.externalLink) return null;
  if (!/^https?:\/\//i.test(origin || '')) throw new Error('A valid public origin is required');

  const canonical = article.canonicalUrl || siteUrl(`/articles/${encodeURIComponent(article.slug)}/`, origin);
  const author = resolveAuthor(article, authors, origin);
  const bodyHtml = addIntrinsicImageSizes(renderMarkdown(article.body));
  const rootHtml = addIntrinsicImageSizes(renderArticle(article, bodyHtml, canonical, author, origin));
  const relatedHtml = addIntrinsicImageSizes(
    renderRelated(article, articles.filter((item) => item.status === 'published')),
  );
  const shell = localiseShell(shellSource);
  return shell
    .replace(/<head>[\s\S]*?<\/head>/, renderHead(article, canonical, author, origin))
    .replace(/<article class="article-page"[\s\S]*?<\/article>/, rootHtml)
    .replace(/<section\s+class="related-section"[\s\S]*?<\/section>/, relatedHtml);
}
