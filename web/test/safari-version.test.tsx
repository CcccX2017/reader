// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { AccountPage } from '../src/features/account/pages/AccountPages.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { applySafariVersion, isIos, readSafariOverride, resolveSafariVersion, writeSafariOverride } from '../src/shared/safari-version.ts';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/605.1.15';
const root = document.createElement('div');
document.body.append(root);

const user = { id: 'u1', username: 'lin', displayName: '林间', role: 'member' as const, createdAt: 0 };
afterEach(() => {
  act(() => render(null, root));
  useAuthStore.setState({ session: null, verifiedUser: null });
  localStorage.clear();
  delete document.documentElement.dataset.safari;
});

describe('safari version', () => {
  it('uses a saved iOS version and otherwise the UA Version token', () => {
    expect(isIos(iphone)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh)')).toBe(false);
    expect(resolveSafariVersion(iphone, '27.2')).toBe('27.2');
    expect(resolveSafariVersion(iphone, '')).toBe('18.6');
    expect(resolveSafariVersion('Mozilla/5.0 Version/17.0 Safari/605', '27.2')).toBe('17.0');
  });

  it('saves the version from the account field and applies it on this device', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: iphone });
    useAuthStore.setState({ verifiedUser: user, session: null });
    const runtime = { api: { updateDisplayName: async () => user }, mediaApi: { accountInfo: () => ({ username: 'lin', displayName: '林间', role: 'member', server: 'https://reader.example', avatarUrl: null }) } };
    act(() => render(<RuntimeContext.Provider value={runtime as never}><MemoryRouter><AccountPage /></MemoryRouter></RuntimeContext.Provider>, root));
    expect(root.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    const input = root.querySelector<HTMLInputElement>('[aria-label="iOS 版本"]')!;
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    expect(input.placeholder).toBe('18.6');
    act(() => { write.call(input, '27.2'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });
    expect(readSafariOverride()).toBe('27.2');
    expect(document.documentElement.dataset.safari).toBe('27.2');
    act(() => { write.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); });
    expect(readSafariOverride()).toBe('');
    expect(document.documentElement.dataset.safari).toBe('18.6');
    expect(() => writeSafariOverride('ios')).toThrow(/27\.2/);
    applySafariVersion(iphone);
    expect(document.documentElement.dataset.safari).toBe('18.6');
  });
});
