/**
 * Dashboard interaction regressions — the editor-side data-loss and
 * navigation behaviour of `apps/web/public/admin/admin.js`.
 *
 * Covered here because the browser smoke pass only reaches the signed-out
 * redirect: duplicate saves, discarded drafts, deep links and the ARIA state of
 * the tab strip are invisible to a page-level HTTP test.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';

const PERMISSIONS = ['article.read.any', 'article.submit', 'article.write', 'author.write', 'settings.write',
  'media.write', 'engagement.moderate', 'inbox.read', 'inbox.write', 'analytics.read', 'audit.read',
  'user.read.any', 'user.write.any', 'user.role.write', 'admin.manage'];

const ARTICLES = [
  { id: 1, slug: 'first-story', title: 'First story', category: 'AI', description: 'One', date: '2026-01-01', status: 'published', tags: [], keyTakeaways: [], relatedSlugs: [], faqs: [], sources: [] },
  { id: 2, slug: 'second-story', title: 'Second story', category: 'Web 3', description: 'Two', date: '2026-01-02', status: 'draft', tags: [], keyTakeaways: [], relatedSlugs: [], faqs: [], sources: [] },
];

let window: Window;
let calls: { url: string; method: string; body?: unknown }[];
let confirmAnswer = true;

function load({ hash = '', total = ARTICLES.length } = {}) {
  calls = [];
  confirmAnswer = true;
  window = new Window({
    url: `https://publication.example/admin/${hash}`,
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  window.document.write(readFileSync('apps/web/public/admin/index.html', 'utf8'));
  window.document.cookie = 'sk_csrf=test-csrf; path=/';
  window.confirm = vi.fn(() => confirmAnswer) as unknown as typeof window.confirm;
  window.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url);
    const method = (init as RequestInit).method ?? 'GET';
    calls.push({ url: path, method, body: (init as RequestInit).body });
    let data: unknown = [];
    let meta: unknown;
    if (path.endsWith('/auth/me')) {
      data = { user: { email: 'admin@example.test', display_name: 'Admin' }, permissions: PERMISSIONS };
    } else if (path.includes('/accounts/capabilities')) {
      data = { owner: false, author: null, workspace_pending: false };
    } else if (path.includes('/articles?status=all')) {
      data = ARTICLES;
      meta = { pagination: { total, page: 1, per_page: 500, total_pages: 1 } };
    } else if (path.includes('/analytics/overview')) {
      data = {
        totals: {}, trends: { days: 30, series: [] }, authors: [], topArticles: [],
        statusBreakdown: [], reactionBreakdown: [], categoryBreakdown: [], activity: [], generatedAt: new Date().toISOString(),
      };
    } else if (path.endsWith('/admin/articles') && method === 'POST') {
      data = { ...ARTICLES[1], id: 3, title: 'Saved once' };
    } else if (path.includes('/admin/accounts')) {
      data = { items: [], pending: 0 };
    }
    return new window.Response(JSON.stringify({ success: true, data, meta }), { status: 200 });
  }) as unknown as typeof window.fetch;
  window.eval(readFileSync('apps/web/public/admin/admin.js', 'utf8'));
}

const el = (id: string) => window.document.getElementById(id)! as unknown as HTMLInputElement;
const set = (id: string, value: string) => { el(id).value = value; };
const submitForm = () => el('articleForm').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));
const panelOf = (name: string) => window.document.querySelector(`[data-panel="${name}"]`) as unknown as HTMLElement;

beforeEach(() => { /* each test calls load() itself */ });
afterEach(async () => { await window?.happyDOM.close(); });

describe('article editor', () => {
  it('posts once when the submit button is pressed during an in-flight save', async () => {
    load();
    await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    await vi.waitFor(() => expect(el('articleList').children.length).toBe(ARTICLES.length));

    set('title', 'Saved once');
    set('category', 'AI');
    set('status', 'draft');
    submitForm();
    el('submitBtn').click();
    submitForm();

    await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/admin/articles'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((call) => call.method === 'POST' && call.url.endsWith('/admin/articles'))).toHaveLength(1);
  });

  it('keeps a dirty article when the user cancels the discard prompt', async () => {
    load();
    await vi.waitFor(() => expect(el('articleList').children.length).toBe(ARTICLES.length));

    (el('articleList').querySelectorAll('button')[0] as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(el('articleId').value).toBe('1'));
    set('title', 'Unsaved rewrite');

    confirmAnswer = false;
    (el('articleList').querySelectorAll('button')[1] as unknown as HTMLButtonElement).click();
    expect(window.confirm).toHaveBeenCalled();
    expect(el('title').value).toBe('Unsaved rewrite');
    expect(el('articleId').value).toBe('1');

    confirmAnswer = true;
    (el('articleList').querySelectorAll('button')[1] as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(el('articleId').value).toBe('2'));
  });

  it('does not prompt when the form matches the saved row', async () => {
    load();
    await vi.waitFor(() => expect(el('articleList').children.length).toBe(ARTICLES.length));
    (el('articleList').querySelectorAll('button')[0] as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(el('articleId').value).toBe('1'));
    (el('articleList').querySelectorAll('button')[1] as unknown as HTMLButtonElement).click();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('reports how many articles the 500-row page actually covers', async () => {
    load({ total: 812 });
    await vi.waitFor(() => expect(el('articleList').children.length).toBe(ARTICLES.length));
    expect(el('articleCount').textContent).toContain('812 total');
  });
});

describe('tab navigation', () => {
  it('marks the strip up as a tablist and keeps aria-selected in step', async () => {
    load();
    await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));

    expect(window.document.getElementById('adminNavigation')!.getAttribute('role')).toBe('tablist');
    expect(panelOf('dashboard').getAttribute('aria-selected')).toBe('true');
    expect(panelOf('inbox').getAttribute('aria-selected')).toBe('false');
    expect(window.document.getElementById('panel-inbox')!.getAttribute('role')).toBe('tabpanel');
    expect(window.document.getElementById('panel-inbox')!.getAttribute('aria-labelledby')).toBe('tab-inbox');

    panelOf('inbox').click();
    await vi.waitFor(() => expect(el('panel-inbox').hidden).toBe(false));
    expect(panelOf('inbox').getAttribute('aria-selected')).toBe('true');
    expect(panelOf('dashboard').getAttribute('aria-selected')).toBe('false');
    expect(window.location.hash).toBe('#inbox');
  });

  it('opens the panel named in the URL hash', async () => {
    load({ hash: '#media' });
    await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    await vi.waitFor(() => expect(el('panel-media').hidden).toBe(false));
    expect(panelOf('media').getAttribute('aria-selected')).toBe('true');
    expect(el('panel-dashboard').hidden).toBe(true);
  });

  it('falls back to the dashboard for a hash the session cannot open', async () => {
    load({ hash: '#accounts' });
    await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    expect(el('panel-dashboard').hidden).toBe(false);
    expect(el('panel-accounts').hidden).toBe(true);
  });

  it('moves selection with the arrow keys', async () => {
    load();
    await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    const articles = panelOf('articles');
    articles.click();
    await vi.waitFor(() => expect(el('panel-articles').hidden).toBe(false));

    articles.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await vi.waitFor(() => expect(window.location.hash).toBe('#authors'));
    expect(el('panel-authors').hidden).toBe(false);
  });
});
