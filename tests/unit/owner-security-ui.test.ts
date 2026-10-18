import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';

let window: Window;
let calls: { url: string; init: RequestInit }[];
const token = 'private-email-link-token-for-dom-test';
function load(fragment: string) {
  calls = [];
  window = new Window({ url: `https://publication.example/reset.html#${fragment}`, settings: {
    disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
  } });
  window.document.write(readFileSync('apps/web/public/reset.html', 'utf8'));
  window.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return new window.Response(JSON.stringify({ success: true, data: { message: 'Completed privately. Sign in again.' } }), { status: 200 });
  }) as typeof window.fetch;
  window.eval(readFileSync('apps/web/public/reset.js', 'utf8'));
}
function element(id: string) { return window.document.getElementById(id)!; }
function fill(id: string, value: string) { (element(id) as unknown as HTMLInputElement).value = value; }
function submit(id: string) { element(id).dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true })); }
afterEach(async () => { await window?.happyDOM.close(); });

describe('private owner setup/recovery forms', () => {
  it('removes the fragment immediately and never submits merely by opening an email', () => {
    load(`owner-setup=${token}`);
    expect(window.location.hash).toBe('');
    expect(element('ownerSecurityCard').hidden).toBe(false);
    expect(element('forgotCard').hidden).toBe(true);
    expect(calls).toHaveLength(0);
    expect(window.document.body.textContent).not.toContain(token);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
  it('checks repeated values and keeps the password separate from the code', () => {
    load(`owner-setup=${token}`);
    fill('ownerPassword', 'private-password-42'); fill('ownerPasswordConfirm', 'does-not-match-42');
    fill('ownerCode', 'private-code-42'); fill('ownerCodeConfirm', 'private-code-42');
    submit('ownerSecurityForm');
    expect(element('ownerSecurityStatus').textContent).toContain('does not match');
    expect(calls).toHaveLength(0);
    fill('ownerPasswordConfirm', 'private-password-42'); fill('ownerCode', 'private-password-42'); fill('ownerCodeConfirm', 'private-password-42');
    submit('ownerSecurityForm');
    expect(element('ownerSecurityStatus').textContent).toContain('different');
    expect(calls).toHaveLength(0);
  });
  it('submits only through a same-origin POST and clears secrets after successful setup', async () => {
    load(`owner-setup=${token}`);
    fill('ownerPassword', 'private-password-42'); fill('ownerPasswordConfirm', 'private-password-42');
    fill('ownerCode', 'private-code-42'); fill('ownerCodeConfirm', 'private-code-42');
    submit('ownerSecurityForm');
    await vi.waitFor(() => expect(element('ownerSecurityForm').hidden).toBe(true));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/v1/auth/owner/setup/complete');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ token, password: 'private-password-42', confirmation_code: 'private-code-42' });
    expect((element('ownerPassword') as unknown as HTMLInputElement).value).toBe('');
    expect((element('ownerCode') as unknown as HTMLInputElement).value).toBe('');
    expect(window.localStorage.length).toBe(0);
  });
  it('uses the current password for recovery and includes the session CSRF header', async () => {
    load(`owner-code=${token}`);
    window.document.cookie = 'sk_csrf=test-csrf-token; path=/';
    expect(element('ownerPasswordLabel').textContent).toBe('Current login password');
    expect(element('ownerPasswordConfirmField').hidden).toBe(true);
    fill('ownerPassword', 'private-password-42'); fill('ownerCode', 'replacement-code-42'); fill('ownerCodeConfirm', 'replacement-code-42');
    submit('ownerSecurityForm');
    await vi.waitFor(() => expect(element('ownerSecurityForm').hidden).toBe(true));
    expect(calls[0]!.url).toBe('/api/v1/auth/owner/code/complete');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ token, current_password: 'private-password-42', confirmation_code: 'replacement-code-42' });
    expect(calls[0]!.init.headers).toMatchObject({ 'X-CSRF-Token': 'test-csrf-token' });
  });
  it('requests setup without accepting a recipient or a password', async () => {
    load('owner-request');
    expect(element('ownerRequestCard').hidden).toBe(false);
    submit('ownerRequestForm');
    await vi.waitFor(() => expect(element('ownerRequestStatus').textContent).toContain('Completed privately'));
    expect(calls[0]!.url).toBe('/api/v1/auth/owner/setup/request');
    expect(calls[0]!.init.body).toBe('{}');
  });
  it('shows failed API requests as text, keeps the form available, and does not navigate', async () => {
    load(`owner-setup=${token}`);
    window.fetch = vi.fn(async () => new window.Response(JSON.stringify({ success: false, error: { message: '<script>expired link</script>' } }), { status: 409 })) as typeof window.fetch;
    fill('ownerPassword', 'private-password-42'); fill('ownerPasswordConfirm', 'private-password-42');
    fill('ownerCode', 'private-code-42'); fill('ownerCodeConfirm', 'private-code-42');
    submit('ownerSecurityForm');
    await vi.waitFor(() => expect(element('ownerSecurityStatus').textContent).toContain('expired link'));
    expect(element('ownerSecurityStatus').querySelector('script')).toBeNull();
    expect(element('ownerSecurityForm').hidden).toBe(false);
    expect(window.location.pathname).toBe('/reset.html');
  });
});
