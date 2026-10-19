import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
let window: Window;
let calls: { url: string; init: RequestInit }[];
const author = { userId: 'alice', authorId: 1, name: 'Alice', slug: 'alice' };
const profile = { id: 1, name: 'Alice', slug: 'alice', bio: 'A writer', image: '', imageAlt: '', profileUrl: '', socialLinks: {} };
const SUPER_ADMIN_PERMISSIONS = ['article.read.any', 'article.submit', 'article.write', 'author.write', 'settings.write',
  'media.write', 'engagement.moderate', 'inbox.read', 'inbox.write', 'analytics.read', 'audit.read', 'user.read.any',
  'user.write.any', 'user.role.write', 'admin.manage'];
function load(isAuthor = true, limitedEditor = false) {
  calls = [];
  window = new Window({ url: 'https://publication.example/admin/', settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  window.document.write(readFileSync('apps/web/public/admin/index.html', 'utf8'));
  window.document.cookie = 'sk_csrf=test-csrf; path=/';
  window.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url); calls.push({ url: path, init: init as RequestInit });
    let data: unknown = [];
    if (path.endsWith('/auth/me')) {
      data = {
        user: { email: 'alice@example.test', display_name: 'Alice' },
        permissions: limitedEditor ? ['article.submit', 'media.write'] : isAuthor ? ['article.submit', 'media.write'] : SUPER_ADMIN_PERMISSIONS,
      };
    }
    else if (path.includes('/accounts/capabilities')) data = { owner: !isAuthor && !limitedEditor, author: isAuthor ? author : null, workspace_pending: false };
    else if (path.includes('/accounts?page=')) data = { items: [], pending: 0 };
    else if (path.endsWith('/author/profile')) data = (init as RequestInit).method === 'PATCH' ? { ...profile, ...JSON.parse(String(init.body)) } : profile;
    else if (path.includes('/author/analytics')) data = { totals: { articles: 1, published: 1, drafts: 0, views: 7, comments: 2, reactions: 3 }, items: [{ title: 'My article', status: 'published', views: 7, comments: 2, reactions: 3 }] };
    else if (path.endsWith('/admin/articles') && (init as RequestInit).method === 'POST') data = { id: 10, title: 'My article', category: 'Science', status: 'published' };
    else if (path.endsWith('/admin/images') && (init as RequestInit).method === 'POST') data = { url: '/uploads/mine.png', id: 5 };
    return new window.Response(JSON.stringify({ success: true, data }), { status: 200 });
  }) as typeof window.fetch;
  window.eval(readFileSync('apps/web/public/admin/admin.js', 'utf8'));
}
function el(id: string) { return window.document.getElementById(id)!; }
function input(id: string, value: string) { (el(id) as unknown as HTMLInputElement).value = value; }
function submit(id: string) { el(id).dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true })); }
function clickTab(panel: string) { (window.document.querySelector(`[data-panel="${panel}"]`) as unknown as HTMLButtonElement).click(); }
afterEach(async () => { await window?.happyDOM.whenAsyncComplete(); await window?.happyDOM.close(); });

describe('author dashboard experience', () => {
  it('opens own articles, hides owner navigation, and never requests global analytics or account lists', async () => {
    load();
    await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    expect(el('panel-articles').hidden).toBe(false); expect(el('panel-dashboard').hidden).toBe(true);
    expect(el('workspaceLabel').textContent).toBe('Author workspace');
    for (const panel of ['accounts', 'authors', 'inbox', 'settings', 'dashboard']) {
      expect((window.document.querySelector(`[data-panel="${panel}"]`) as unknown as HTMLElement).hidden).toBe(true);
    }
    for (const panel of ['articles', 'media', 'comments', 'profile', 'author-analytics']) {
      expect((window.document.querySelector(`[data-panel="${panel}"]`) as unknown as HTMLElement).hidden).toBe(false);
    }
    expect(calls.some((call) => call.url.includes('/admin/analytics'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/admin/accounts?page='))).toBe(false);
    expect((el('authorSlug') as unknown as HTMLInputElement).readOnly).toBe(true);
    expect((el('status') as unknown as HTMLSelectElement).value).toBe('draft');
  });
  it('lets authors choose published without submission-for-review-only messaging', async () => {
    load(); await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    input('status', 'published'); el('status').dispatchEvent(new window.Event('change'));
    expect(el('statusHelp').textContent).toBe('Publish your article immediately.');
    expect(el('submitBtn').textContent).toContain('Publish');
    expect((el('featured') as unknown as HTMLInputElement).disabled).toBe(true);
  });
  it('saves the own profile through the scoped endpoint with CSRF and without a user ID', async () => {
    load(); await vi.waitFor(() => expect(el('selfProfileStatus').textContent).toContain('ready'));
    clickTab('profile'); await vi.waitFor(() => expect(el('selfProfileStatus').textContent).toContain('ready'));
    input('selfName', 'Alice Updated'); input('selfBio', 'Updated biography'); input('selfSocialGithub', 'https://github.com/alice');
    submit('selfProfileForm');
    await vi.waitFor(() => expect(el('selfProfileStatus').textContent).toContain('updated'));
    const call = calls.find((call) => call.url.endsWith('/author/profile') && call.init.method === 'PATCH')!;
    const payload = JSON.parse(String(call.init.body));
    expect(payload.name).toBe('Alice Updated'); expect(payload.socialLinks.github).toBe('https://github.com/alice');
    expect(payload.user_id).toBeUndefined(); expect(call.init.headers).toMatchObject({ 'X-CSRF-Token': 'test-csrf' });
  });
  it('uses the own analytics endpoint and renders only its returned rows', async () => {
    load(); await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false)); clickTab('author-analytics');
    await vi.waitFor(() => expect(el('selfAnalyticsRows').textContent).toContain('My article'));
    expect(calls.some((call) => call.url.includes('/admin/author/analytics?days=30'))).toBe(true);
    expect(el('selfAnalyticsTotals').textContent).toContain('7Reads');
    expect((el('nextSelfAnalytics') as unknown as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((call) => call.url.includes('/admin/analytics/'))).toBe(false);
  });
  it('uploads media to the protected upload endpoint, not the public image index', async () => {
    load(); await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    const file = new window.File(['test'], 'mine.png', { type: 'image/png' });
    Object.defineProperty(el('imageFile'), 'files', { configurable: true, value: [file] }); input('imageAlt', 'My image');
    submit('uploadForm');
    await vi.waitFor(() => expect(calls.some((call) => call.url === '/api/v1/admin/images' && call.init.method === 'POST')).toBe(true));
    expect(calls.some((call) => call.url === '/api/v1/images' && call.init.method === 'POST')).toBe(false);
  });
  it('hides navigation a contributing editor cannot use and lands on articles', async () => {
    load(false, true); await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    for (const panel of ['dashboard', 'authors', 'inbox', 'settings', 'accounts', 'comments']) {
      expect((window.document.querySelector(`[data-panel="${panel}"]`) as unknown as HTMLElement).hidden, panel).toBe(true);
    }
    for (const panel of ['articles', 'media']) {
      expect((window.document.querySelector(`[data-panel="${panel}"]`) as unknown as HTMLElement).hidden, panel).toBe(false);
    }
    expect(el('panel-articles').hidden).toBe(false);
    expect(el('panel-dashboard').hidden).toBe(true);
    expect(calls.some((call) => call.url.includes('/admin/analytics'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/admin/accounts?page='))).toBe(false);
  });
  it('keeps owner tools visible for the owner and hides author-only panels', async () => {
    load(false); await vi.waitFor(() => expect(el('adminMain').hidden).toBe(false));
    expect(el('accountAccessTab').hidden).toBe(false);
    expect((window.document.querySelector('[data-panel="profile"]') as unknown as HTMLElement).hidden).toBe(true);
    expect((window.document.querySelector('[data-panel="dashboard"]') as unknown as HTMLElement).hidden).toBe(false);
  });
});
