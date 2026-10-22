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
  { id: 1, slug: 'first-story', title: 'First story', category: 'AI', description: 'One', date: '2026-01-01', status: 'published', tags: [], keyTakeaways: [], relatedSlugs: [], faqs: [], sources: [], updatedAt: '2026-01-01T00:00:00.000Z', scheduledAt: null },
  { id: 2, slug: 'second-story', title: 'Second story', category: 'Web 3', description: 'Two', date: '2026-01-02', status: 'draft', tags: [], keyTakeaways: [], relatedSlugs: [], faqs: [], sources: [], updatedAt: '2026-01-02T00:00:00.000Z', scheduledAt: null },
];

const SUBSCRIBERS = Array.from({ length: 50 }, (_, index) => ({
  id: index + 1, name: `Reader ${index + 1}`, email: `reader${index + 1}@example.test`,
  status: 'active', createdAt: '2026-02-01 10:00:00',
}));

let window: Window;
let calls: { url: string; method: string; body?: unknown }[];
let confirmAnswer = true;

function load({ hash = '', total = ARTICLES.length, bootFailure = null }: {
  hash?: string; total?: number; bootFailure?: { status: number; message: string; requestId?: string } | null;
} = {}) {
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
      if (bootFailure) {
        return new window.Response(JSON.stringify({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: bootFailure.message },
          meta: { request_id: bootFailure.requestId },
        }), { status: bootFailure.status });
      }
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
    } else if (/\/admin\/articles\/\d+$/.test(path) && method === 'PUT') {
      const body = JSON.parse(String((init as RequestInit).body));
      data = { ...ARTICLES[0], ...body, updatedAt: '2026-03-01T00:00:00.000Z' };
    } else if (path.includes('/admin/subscriptions')) {
      const page = Number(new URL(path, 'https://x.test').searchParams.get('page') ?? 1);
      data = page === 1 ? SUBSCRIBERS : SUBSCRIBERS.slice(0, 5).map((row) => ({ ...row, id: row.id + 100 }));
      meta = { pagination: { page, per_page: 50, total: 55, total_pages: 2 } };
    } else if (path.includes('/admin/contact-messages')) {
      data = [];
      meta = { pagination: { page: 1, per_page: 50, total: 0, total_pages: 1 } };
    } else if (path.includes('/admin/system/stats')) {
      data = { users: { total: 12, verified: 11, editors: 3, admins: 2, pending: 1, suspended: 0, newThisMonth: 2 }, articles: { published: 56, draft: 4, scheduled: 1, pending: 2, other: 0 } };
    } else if (path.includes('/admin/system/audit')) {
      data = [{ id: 9, actor_user_id: 'usr_admin', actor_role: 'super_admin', action: 'article.published', entity_type: 'article', entity_id: '56', description: 'Article published', created_at: '2026-03-01T09:00:00.000Z' }];
    } else if (path.includes('/admin/system/maintenance') && method === 'POST') {
      data = { scheduled_published: 1, sessions_deleted: 2, tokens_deleted: 0, rate_limits_deleted: 4, audit_rows_deleted: 0, articles_reattributed: 0 };
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

describe('bootstrap failures', () => {
  it('shows a server fault with its request id instead of bouncing to sign-in', async () => {
    load({ bootFailure: { status: 500, message: 'Something went wrong on our side. Please try again.', requestId: 'req_test_500' } });
    await vi.waitFor(() => expect(el('adminLoading').textContent).toContain('could not load'));
    expect(el('adminLoading').textContent).toContain('Something went wrong on our side');
    expect(el('adminLoading').textContent).toContain('req_test_500');
    expect(window.location.pathname).toBe('/admin/');
    expect(el('adminMain').hidden).toBe(true);
  });

  it('still sends a genuinely unauthenticated visitor to the sign-in page', async () => {
    load({ bootFailure: { status: 401, message: 'Sign in to continue' } });
    await vi.waitFor(() => expect(window.location.pathname).toBe('/login.html'));
    expect(window.location.search).toContain('next=%2Fadmin%2F');
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

describe('scheduling, autosave and concurrency', () => {
  it('sends a scheduled time as one UTC instant and shows it back on the local clock', async () => {
    load();
    await vi.waitFor(() => expect(el('articleList').children.length).toBe(ARTICLES.length));
    (el('articleList').querySelectorAll('button')[1] as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(el('articleId').value).toBe('2'));

    // The editor picks a wall-clock time; the payload carries the UTC instant.
    el('scheduledAt').value = '2026-11-01T09:00';
    set('title', 'Second story');
    set('category', 'Web 3');
    set('status', 'scheduled');
    set('description', 'A teaser long enough to satisfy the Forty character minimum.');
    set('body', `<p>${'Editorial copy. '.repeat(20)}</p><h2>A heading</h2>`);
    set('tags', 'AI\nWeb 3');
    set('author', 'Sholynk Desk');
    set('submitterEmail', 'desk@sholynk.test');
    submitForm();

    await vi.waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    const body = JSON.parse(String(calls.find((call) => call.method === 'PUT')!.body));
    expect(body.scheduledAt).toBe(new Date('2026-11-01T09:00').toISOString());
    expect(body.expectedUpdatedAt).toBe(ARTICLES[1].updatedAt);
    // Let the save finish before the window closes, so its toast is not an
    // unhandled rejection in a later test.
    await vi.waitFor(() => expect(el('toast').textContent).toContain('updated'));
  });

  it('autosaves a dirty form and offers it back after a reload', async () => {
    load();
    await vi.waitFor(() => expect(el('articleList').children.length).toBe(ARTICLES.length));
    (el('articleList').querySelectorAll('button')[1] as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(el('articleId').value).toBe('2'));

    set('title', 'Recovered after a crash');
    el('title').dispatchEvent(new window.Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(el('autosaveNote').textContent).toContain('autosaved'), { timeout: 4000 });

    const snapshot = window.localStorage.getItem('sholynk.admin.draft.2');
    expect(snapshot).toContain('Recovered after a crash');

    // A fresh page load finds the snapshot and restores it after confirmation.
    const stored = JSON.stringify({ ...JSON.parse(snapshot!), savedAt: new Date().toISOString() });
    load();
    window.localStorage.setItem('sholynk.admin.draft.2', stored);
    await vi.waitFor(() => expect(el('articleList').children.length).toBe(ARTICLES.length));
    (el('articleList').querySelectorAll('button')[1] as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(el('title').value).toBe('Recovered after a crash'));
    expect(window.confirm).toHaveBeenCalled();
  });

  it('drops the snapshot when the restore is declined', async () => {
    load();
    await vi.waitFor(() => expect(el('articleList').children.length).toBe(ARTICLES.length));
    window.localStorage.setItem('sholynk.admin.draft.2', JSON.stringify({ title: 'Stale copy', savedAt: '2026-01-01T00:00:00.000Z' }));
    confirmAnswer = false;
    (el('articleList').querySelectorAll('button')[1] as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(el('articleId').value).toBe('2'));
    expect(el('title').value).toBe('Second story');
    expect(window.localStorage.getItem('sholynk.admin.draft.2')).toBeNull();
  });

  it('never silently unpublishes a live article', async () => {
    load();
    await vi.waitFor(() => expect(el('articleList').children.length).toBe(ARTICLES.length));
    (el('articleList').querySelectorAll('button')[0] as unknown as HTMLButtonElement).click();
    await vi.waitFor(() => expect(el('articleId').value).toBe('1'));
    confirmAnswer = false;
    set('status', 'draft');
    submitForm();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(window.confirm).toHaveBeenCalled();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });
});

describe('inbox and system panels', () => {
  it('pages the subscriber table and reports the real total', async () => {
    load();
    await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    panelOf('inbox').click();
    await vi.waitFor(() => expect(el('subscriberTableBody').children.length).toBe(50));
    expect(el('subscriberCount').textContent).toContain('Showing 50 of 55');
    expect(el('moreSubscribers').hidden).toBe(false);

    el('moreSubscribers').click();
    await vi.waitFor(() => expect(el('subscriberTableBody').children.length).toBe(55));
    expect(calls.some((call) => call.url.includes('/admin/subscriptions?page=2'))).toBe(true);
  });

  it('filters subscribers without another request', async () => {
    load();
    await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    panelOf('inbox').click();
    await vi.waitFor(() => expect(el('subscriberTableBody').children.length).toBe(50));
    const before = calls.length;
    set('subscriberSearch', 'reader7@');
    el('subscriberSearch').dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(el('subscriberTableBody').children.length).toBe(1);
    expect(calls.length).toBe(before);
  });

  it('renders the system snapshot, audit trail and runs maintenance', async () => {
    load();
    await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    expect(panelOf('system').hidden).toBe(false);
    panelOf('system').click();
    await vi.waitFor(() => expect(el('systemStats').children.length).toBeGreaterThan(0));
    expect(el('systemStats').textContent).toContain('Published articles');
    expect(el('systemStats').textContent).toContain('56');
    expect(el('auditTableBody').children.length).toBe(1);
    expect(el('auditTableBody').textContent).toContain('Article published');

    el('runMaintenance').click();
    await vi.waitFor(() => expect(el('maintenanceStatus').textContent).toContain('published'));
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/admin/system/maintenance'))).toBe(true);
    expect(el('maintenanceStatus').textContent).toContain('session');
  });
});
