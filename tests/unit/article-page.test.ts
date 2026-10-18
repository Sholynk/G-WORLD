/**
 * The server-side article page renderer (lib/article-page.ts).
 *
 * These tests render a representative article through the same code path the
 * edge uses and assert the invariants the reading experience and SEO depend
 * on: the shell swap points, the server-rendered marker, canonical/Open Graph
 * tags, JSON-LD, the table of contents threshold, related-story selection and
 * the refusal to render anything unpublished or bodyless.
 */
import { describe, expect, it } from 'vitest';
import {
  relatedFor,
  renderArticlePage,
  renderToc,
  resolveAuthor,
} from '../../apps/api/src/lib/article-page.js';
import type { RenderableArticle, RenderableAuthor } from '../../apps/api/src/lib/article-page.js';

const ORIGIN = 'https://sholynk.example';

function makeArticle(overrides: Partial<RenderableArticle> = {}): RenderableArticle {
  return {
    slug: 'the-rise-of-esports',
    title: 'The Rise of Esports',
    category: 'Game',
    description: 'Competitive gaming has become a mainstream spectator sport.',
    body: [
      '## Introduction',
      '',
      'Esports filled arenas this year.',
      '',
      '## The business model',
      '',
      'Sponsors, media rights and tickets.',
      '',
      '## What comes next',
      '',
      'Mobile and regional leagues.',
    ].join('\n'),
    img: 'assets/articles/the-rise-of-esports/esports-arena-stage.jpg',
    alt: 'An esports arena',
    author: 'Oluwashola Busari',
    authorSlug: 'oluwashola-busari',
    date: '2026-08-06',
    readingTime: '9 min read',
    status: 'published',
    keyTakeaways: ['Esports is mainstream', 'Revenue is diversifying'],
    directAnswer: 'Esports is competitive, organised video gaming watched as a sport.',
    faqs: [{ question: 'Is esports a sport?', answer: 'By every practical measure, yes.' }],
    sources: [
      { title: 'League viewership report', url: 'https://example.dev/report', publisher: 'Example Press' },
    ],
    relatedSlugs: ['multimodal-ai-models'],
    tags: ['esports', 'gaming'],
    ...overrides,
  };
}

const AUTHORS: RenderableAuthor[] = [
  {
    slug: 'oluwashola-busari',
    name: 'Oluwashola Busari',
    bio: 'The founder of Sholynk Technology.',
    role: 'Founder',
    image: 'assets/brand/my_pic.png',
    imageAlt: 'Portrait photo of Oluwashola Busari',
    profileUrl: 'about.html',
  },
];

describe('renderArticlePage', () => {
  it('renders the full document from the shared shell', () => {
    const html = renderArticlePage({ article: makeArticle(), authors: AUTHORS, origin: ORIGIN });
    expect(html).not.toBeNull();
    // The shell's three swap points were all replaced.
    expect(html).toContain('data-server-rendered="true"');
    expect(html).toContain('data-slug="the-rise-of-esports"');
    expect(html).not.toContain('Loading article...');
    // Two levels deep: local assets point back at the site root.
    expect(html).toContain('../../styles.css');
    expect(html).toContain('../../cms-client.js');
    expect(html).toContain('src="../../assets/articles/the-rise-of-esports/esports-arena-stage.jpg"');
  });

  it('emits canonical, Open Graph, Twitter and JSON-LD metadata', () => {
    const html = renderArticlePage({ article: makeArticle(), authors: AUTHORS, origin: ORIGIN })!;
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/articles/the-rise-of-esports/" />`);
    expect(html).toContain('<meta property="og:site_name" content="Sholynk Tech" />');
    expect(html).toContain('<title>The Rise of Esports | Sholynk Tech</title>');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"name":"Sholynk Technology"'); // the Organization (company) keeps its name
    // The JSON-LD payload is `<`-escaped (safeJson), so no raw markup can be
    // smuggled into the document through a title or description, and it still
    // parses as JSON.
    const jsonld = /application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(jsonld.length).toBeGreaterThan(0);
    expect(jsonld).not.toContain('<');
    expect(JSON.parse(jsonld)).toHaveProperty('@graph');
  });

  it('prefers seoTitle/seoDescription and a canonical override', () => {
    const html = renderArticlePage({
      article: makeArticle({
        seoTitle: 'Esports growth, explained',
        seoDescription: 'A short SEO summary.',
        canonicalUrl: 'https://partner.example/the-rise-of-esports',
      }),
      authors: AUTHORS,
      origin: ORIGIN,
    })!;
    expect(html).toContain('<title>Esports growth, explained</title>');
    expect(html).toContain('<link rel="canonical" href="https://partner.example/the-rise-of-esports" />');
  });

  it('builds the TOC only from the third h2 onwards', () => {
    const html = renderArticlePage({ article: makeArticle(), authors: AUTHORS, origin: ORIGIN })!;
    expect(html).toContain('In this article');
    expect(html).toContain('#introduction');
    expect(html).toContain('#the-business-model');
    // Two-h2 articles get no TOC.
    const short = renderArticlePage({
      article: makeArticle({ body: '## One\n\ntext\n\n## Two\n\ntext' }),
      authors: AUTHORS,
      origin: ORIGIN,
    })!;
    expect(short).not.toContain('In this article');
  });

  it('renders quick answer, takeaways, FAQs and sources sections', () => {
    const html = renderArticlePage({ article: makeArticle(), authors: AUTHORS, origin: ORIGIN })!;
    expect(html).toContain('Quick answer');
    expect(html).toContain('Key takeaways');
    expect(html).toContain('Frequently asked questions');
    expect(html).toContain('<section class="article-sources"');
    expect(html).toContain('https://example.dev/report');
  });

  it('stamps intrinsic sizes on body images so anchors do not drift', () => {
    const html = renderArticlePage({
      article: makeArticle({
        body: '## Intro\n\n![Arena](assets/articles/the-rise-of-esports/esports-arena-stage.jpg)\n\n## Two\n\nx\n\n## Three\n\ny',
      }),
      authors: AUTHORS,
      origin: ORIGIN,
    })!;
    expect(html).toMatch(/<img[^>]+width="\d+"[^>]+height="\d+"/);
  });

  it('refuses to render unpublished, bodyless or external-link articles', () => {
    expect(renderArticlePage({ article: makeArticle({ status: 'draft' }), authors: AUTHORS, origin: ORIGIN })).toBeNull();
    expect(renderArticlePage({ article: makeArticle({ body: '' }), authors: AUTHORS, origin: ORIGIN })).toBeNull();
    expect(
      renderArticlePage({ article: makeArticle({ externalLink: 'index.html?category=Game' }), authors: AUTHORS, origin: ORIGIN }),
    ).toBeNull();
  });

  it('requires a valid origin', () => {
    expect(() => renderArticlePage({ article: makeArticle(), authors: AUTHORS, origin: 'not-a-url' })).toThrow(
      /valid public origin/i,
    );
  });
});

describe('renderToc', () => {
  it('marks the first entry as the current location', () => {
    const toc = renderToc('<h2 id="a">A</h2><h2 id="b">B</h2><h2 id="c">C</h2>');
    expect(toc).toContain('aria-current="location"');
    expect(toc.split('aria-current').length - 1).toBe(1);
  });

  it('returns nothing below three headings', () => {
    expect(renderToc('<h2 id="a">A</h2><h2 id="b">B</h2>')).toBe('');
  });
});

describe('relatedFor', () => {
  const related = makeArticle({ slug: 'multimodal-ai-models', category: 'AI Trends', body: 'body' });
  const sameCategory = makeArticle({ slug: 'another-game-story', category: 'Game', body: 'body' });
  const bodyless = makeArticle({ slug: 'card-only', category: 'Game', body: '' });

  it('prefers explicit relatedSlugs, then same-category stories, max four', () => {
    const all = [makeArticle(), related, sameCategory, bodyless];
    const chosen = relatedFor(makeArticle(), all);
    expect(chosen[0]!.slug).toBe('multimodal-ai-models');
    expect(chosen.map((item) => item.slug)).toContain('another-game-story');
    expect(chosen.map((item) => item.slug)).not.toContain('card-only');
    expect(chosen.length).toBeLessThanOrEqual(4);
  });

  it('never includes the article itself', () => {
    const chosen = relatedFor(makeArticle(), [makeArticle(), sameCategory]);
    expect(chosen.map((item) => item.slug)).not.toContain('the-rise-of-esports');
  });
});

describe('resolveAuthor', () => {
  it('falls back to the house author for unknown slugs', () => {
    const resolved = resolveAuthor(makeArticle({ authorSlug: 'ghost-writer' }), AUTHORS, ORIGIN);
    expect(resolved.slug).toBe('ghost-writer');
    expect(resolved.name).toBe('Oluwashola Busari'); // the entity is unknown, the byline survives
    expect(resolved.id).toBe(`${ORIGIN}/about.html#ghost-writer`);
  });

  it('builds the profile anchor from the entity', () => {
    const resolved = resolveAuthor(makeArticle(), AUTHORS, ORIGIN);
    expect(resolved.id).toBe(`${ORIGIN}/about.html#oluwashola-busari`);
    expect(resolved.profileUrl).toBe(`${ORIGIN}/about.html`);
  });
});
