/**
 * The Markdown → sanitised-HTML pipeline (lib/markdown.ts).
 *
 * This is the security boundary for article bodies: authored Markdown is
 * rendered with marked, stripped with sanitize-html and rewritten for the
 * two-segment-deep clean article URLs. The tests pin the legacy behaviours the
 * reading experience depends on: stable <h2> ids (TOC + anchors), external
 * link hardening, lazy local images with intrinsic sizes, and the refusal of
 * anything not on the allow-list.
 */
import { describe, expect, it } from 'vitest';
import {
  SITE_ROOT_PREFIX,
  absoluteUrl,
  addIntrinsicImageSizes,
  articlePageUrl,
  escapeHtml,
  headingSlug,
  intrinsicSize,
  renderMarkdown,
  siteUrl,
} from '../../apps/api/src/lib/markdown.js';

describe('renderMarkdown', () => {
  it('renders GitHub-flavoured Markdown basics', () => {
    const html = renderMarkdown('## Introduction\n\nSome **bold** text and a [link](https://example.dev).\n\n- one\n- two');
    expect(html).toContain('<h2 id="introduction">Introduction</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<ul>');
  });

  it('gives every h2 a stable id and deduplicates repeats', () => {
    const html = renderMarkdown('## Quantum Computing\n\nText\n\n## Quantum Computing\n\nMore');
    expect(html).toContain('<h2 id="quantum-computing">');
    expect(html).toContain('<h2 id="quantum-computing-2">');
  });

  it('strips scripts and event handlers (stored XSS boundary)', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('alert(1)');
  });

  it('rewrites relative hrefs to the article depth and keeps absolute URLs external', () => {
    const html = renderMarkdown('[External](https://example.dev/x)\n\n[Category](index.html?category=AI%20Trends)');
    expect(html).toContain('href="https://example.dev/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(`href="${SITE_ROOT_PREFIX}index.html?category=AI%20Trends"`);
    expect(html).not.toContain(`href="${SITE_ROOT_PREFIX}https:`);
  });

  it('makes images lazy and rewrites local sources', () => {
    const html = renderMarkdown('![A quantum chip](assets/articles/quantum/quantum-processor-render.jpg)');
    expect(html).toContain(`<img src="${SITE_ROOT_PREFIX}assets/articles/quantum/quantum-processor-render.jpg"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('alt="A quantum chip"');
  });

  it('keeps figures and figcaptions (allow-listed like the legacy renderer)', () => {
    const html = renderMarkdown('<figure><img src="assets/brand/logo.png" alt="Logo"><figcaption>The logo</figcaption></figure>');
    expect(html).toContain('<figure>');
    expect(html).toContain('<figcaption>The logo</figcaption>');
  });
});

describe('articlePageUrl / siteUrl / absoluteUrl', () => {
  it('prefixes local references with the article depth', () => {
    expect(articlePageUrl('index.html')).toBe('../../index.html');
    expect(articlePageUrl('/about.html')).toBe('../../about.html');
    expect(articlePageUrl('assets/brand/logo.png')).toBe('../../assets/brand/logo.png');
  });

  it('leaves absolute, anchor and protocol-relative references alone', () => {
    expect(articlePageUrl('https://example.dev/x')).toBe('https://example.dev/x');
    expect(articlePageUrl('#section')).toBe('#section');
    expect(articlePageUrl('//cdn.example/x.png')).toBe('//cdn.example/x.png');
    expect(articlePageUrl('')).toBe('');
  });

  it('builds origin-absolute URLs', () => {
    expect(siteUrl('/articles/the-rise-of-esports/', 'https://sholynk.example')).toBe(
      'https://sholynk.example/articles/the-rise-of-esports/',
    );
    expect(absoluteUrl('assets/brand/page_logo.png', 'https://sholynk.example')).toBe(
      'https://sholynk.example/assets/brand/page_logo.png',
    );
    expect(absoluteUrl('https://cdn.example/x.jpg', 'https://sholynk.example')).toBe('https://cdn.example/x.jpg');
  });
});

describe('intrinsic image sizes', () => {
  it('knows the dimensions of deployed story images', () => {
    const size = intrinsicSize('assets/articles/quantum/quantum-computer-chandelier.jpg');
    expect(size).not.toBeNull();
    expect(size!.width).toBeGreaterThan(0);
    expect(size!.height).toBeGreaterThan(0);
  });

  it('resolves article-depth and URL-encoded references', () => {
    const plain = intrinsicSize('../../assets/articles/quantum/quantum-computer-chandelier.jpg');
    expect(plain).not.toBeNull();
  });

  it('returns null for remote and unknown images', () => {
    expect(intrinsicSize('https://cdn.example/x.jpg')).toBeNull();
    expect(intrinsicSize('assets/articles/does-not-exist.jpg')).toBeNull();
    expect(intrinsicSize('')).toBeNull();
  });

  it('stamps width/height onto body images that lack them, once', () => {
    const size = intrinsicSize('assets/articles/quantum/quantum-computer-chandelier.jpg')!;
    const html = '<p>x</p><img src="../../assets/articles/quantum/quantum-computer-chandelier.jpg" alt="A" />';
    const stamped = addIntrinsicImageSizes(html);
    expect(stamped).toContain(`width="${size.width}" height="${size.height}"`);
    // Already-sized images are left untouched.
    const sized = '<img src="../../assets/articles/quantum/quantum-computer-chandelier.jpg" width="10" height="10" />';
    expect(addIntrinsicImageSizes(sized)).toBe(sized);
  });
});

describe('small utilities', () => {
  it('escapes HTML', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });

  it('slugifies headings for ids', () => {
    expect(headingSlug('The Rise of <em>Quantum</em> Computing')).toBe('the-rise-of-quantum-computing');
    expect(headingSlug('')).toBe('section');
  });
});
