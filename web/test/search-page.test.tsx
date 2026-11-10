// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { SearchPage } from '../src/features/search/pages/SearchPage.tsx';

const root = document.createElement('div');
document.body.append(root);
const user = { id: 'reader', username: 'reader', displayName: 'Reader', role: 'admin' as const, createdAt: 0, mediaEnabled: false, features: { media: false } };
const listBooks = vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 12 }));
const runtime = {
  api: { baseUrl: 'https://reader.example', currentSession: () => ({ user }), listBooks },
  mediaApi: { preferenceScope: () => 'search-page-test', search: vi.fn() },
} as never;
let client: QueryClient;

const paint = () => act(async () => render(
  <RuntimeContext value={runtime}>
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/search']}><SearchPage /></MemoryRouter>
    </QueryClientProvider>
  </RuntimeContext>,
  root,
));

function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ session: { user, accessToken: 'access', refreshToken: 'refresh', accessTokenExpiresAt: 9e15, refreshTokenExpiresAt: 9e15 }, verifiedUser: user });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  act(() => render(null, root));
  client.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
  useAuthStore.setState({ session: null, verifiedUser: null });
});

it('does not search a Chinese composition until it is committed', async () => {
  await paint();
  const input = root.querySelector('input')!;
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => typeInto(input, 'zhong'));
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(listBooks).not.toHaveBeenCalled();

  await act(async () => {
    typeInto(input, '中');
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(349); });
  expect(listBooks).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(listBooks).toHaveBeenCalledWith(expect.objectContaining({ search: '中' }), expect.anything());
});

it('searches a finished word after the pause', async () => {
  await paint();
  const input = root.querySelector('input')!;
  await act(async () => typeInto(input, '剑来'));
  await act(async () => { await vi.advanceTimersByTimeAsync(349); });
  expect(listBooks).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(listBooks).toHaveBeenCalledWith(expect.objectContaining({ search: '剑来' }), expect.anything());
});
