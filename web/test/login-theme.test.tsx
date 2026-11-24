// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { LoginPage } from '../src/features/auth/pages/LoginPage.tsx';
import {
  loginThemeScope,
  readThemePreference,
  rememberLoginTheme,
  saveThemePreference,
} from '../src/shared/theme/theme.ts';

const root = document.createElement('div');
document.body.append(root);
const server = 'https://reader.example.com';
const account = JSON.stringify([server, 'reader']);
let dark = false;
const changes = new Set<() => void>();

beforeEach(() => {
  dark = false;
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_: string, listener: () => void) => changes.add(listener),
    removeEventListener: (_: string, listener: () => void) => changes.delete(listener),
  }));
});
afterEach(() => {
  act(() => render(null, root));
  expect(changes.size).toBe(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function paint() {
  const runtime = {
    api: { baseUrl: server, setBaseUrl: vi.fn(), instance: vi.fn().mockResolvedValue({ userCount: 1 }) },
  } as any;
  await act(async () => {
    render(
      <RuntimeContext value={runtime}>
        <LoginPage />
      </RuntimeContext>,
      root,
    );
    // The form stays hidden until the first instance answer, so the built-in name cannot flash.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it('applies the last account appearance from the anonymous server scope before painting login', async () => {
  saveThemePreference(account, { theme: 'glass', mode: 'dark' });
  rememberLoginTheme(server, account);
  expect(readThemePreference(loginThemeScope(server + '/'))).toMatchObject({ theme: 'glass', mode: 'dark' });
  await paint();
  expect(document.documentElement.dataset).toMatchObject({ theme: 'glass', mode: 'dark' });
  expect(root.querySelector('input[autocomplete="username"]')).not.toBeNull();
  expect(readThemePreference(account)).toMatchObject({ theme: 'glass', mode: 'dark' });
});

it('follows the saved system slots and subscribes to device mode changes on login', async () => {
  saveThemePreference(loginThemeScope(server), { mode: 'system', system: { light: 'green', dark: 'glass' } });
  await paint();
  expect(document.documentElement.dataset).toMatchObject({ theme: 'green', mode: 'light' });
  act(() => {
    dark = true;
    for (const listener of changes) listener();
  });
  expect(document.documentElement.dataset).toMatchObject({ theme: 'glass', mode: 'dark' });
});

it('isolates servers and updates the login theme when the connection address changes', async () => {
  saveThemePreference(loginThemeScope(server), { theme: 'glass', mode: 'dark' });
  const other = 'https://other.example.com';
  saveThemePreference(loginThemeScope(other), { theme: 'blue', mode: 'light' });
  await paint();
  const field = root.querySelector<HTMLInputElement>('#login-server')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, other);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.documentElement.dataset).toMatchObject({ theme: 'blue', mode: 'light' });
  expect(readThemePreference(loginThemeScope(server))).toMatchObject({ theme: 'glass', mode: 'dark' });
});

it.each([null, '{broken'])('uses a safe default with missing or corrupt local preferences (%s)', async (stored) => {
  if (stored !== null) localStorage.setItem('reader.theme.v2:' + loginThemeScope(server), stored);
  await paint();
  expect(document.documentElement.dataset).toMatchObject({ theme: 'warm', mode: 'light' });
});

it('renders and permits theme mirroring to fail safely when local storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => rememberLoginTheme(server, account)).not.toThrow();
  await paint();
  expect(document.documentElement.dataset).toMatchObject({ theme: 'warm', mode: 'light' });
});
