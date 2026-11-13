// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { SourcesPage } from '../src/features/sources/pages/SourcesPage.tsx';

const root = document.createElement('div');
document.body.append(root);
const source = {
  id: 'local', pluginId: 'reader.local', sourceType: 'local', name: '本地书库', enabled: true, isDefault: true,
  descriptor: { id: 'local', pluginId: 'reader.local', label: '本地书库', version: '1', builtin: true, capabilities: ['search', 'browse'] },
};
const books = Array.from({ length: 15 }, (_, index) => ({
  ref: `book-${index + 1}`, title: `测试书 ${index + 1}`, authors: ['作者'],
}));
const searchSource = vi.fn(async function* (_id: string, query: { limit?: number }) {
  expect(query.limit).toBe(10);
  yield { items: books };
});
const sourceCatalog = vi.fn(async (_id: string, query: { limit?: number; cursor?: string } = {}) => {
  expect(query.limit).toBe(10);
  if (query.cursor) return { items: books.slice(10), total: 15 };
  return { items: books.slice(0, 10), nextCursor: '2', total: 15 };
});
const runtime = {
  api: {
    baseUrl: 'https://reader.example',
    currentSession: () => null,
    sources: vi.fn(async () => [source]),
    sourceTypes: vi.fn(async () => []),
    searchSource,
    sourceCatalog,
  },
} as never;
let client: QueryClient;

function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const paint = () => act(async () => render(
  <RuntimeContext value={runtime}>
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/sources']}><SourcesPage /></MemoryRouter>
    </QueryClientProvider>
  </RuntimeContext>,
  root,
));

function keyword() {
  return root.querySelector<HTMLInputElement>('.source-keyword input')!;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ session: null, verifiedUser: null });
  searchSource.mockClear();
  sourceCatalog.mockClear();
  // Desktop path: no matchMedia coarse/narrow → 加载更多 button.
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    media: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
});

afterEach(() => {
  act(() => render(null, root));
  client.clear();
  vi.unstubAllGlobals();
});

it('loads the local library on entry and pages ten books at a time', async () => {
  await paint();
  await vi.waitFor(() => expect(root.textContent).toContain('测试书 1'));
  expect(sourceCatalog).toHaveBeenCalled();
  expect(root.textContent).toContain('测试书 10');
  expect(root.textContent).not.toContain('测试书 11');
  expect(root.textContent).toContain('已显示 10 / 15 本');
  const more = root.querySelector<HTMLButtonElement>('.catalog-pagination button');
  expect(more?.textContent).toContain('加载更多');
  await act(async () => { more!.click(); });
  await vi.waitFor(() => expect(root.textContent).toContain('测试书 15'));
  expect(root.textContent).toContain('已显示 15 本');
  expect(root.querySelector('.catalog-pagination button')).toBeNull();
});

it('shows ten search hits first and reveals more from 加载更多', async () => {
  await paint();
  await vi.waitFor(() => expect(keyword()).toBeTruthy());
  await act(async () => { typeInto(keyword(), '测试'); });
  await act(async () => { keyword().form!.requestSubmit(); });
  await vi.waitFor(() => expect(root.textContent).toContain('测试书 1'));
  expect(root.textContent).toContain('已显示 10 / 15 本书');
  expect(root.textContent).toContain('测试书 10');
  expect(root.textContent).not.toContain('测试书 11');
  const more = root.querySelector<HTMLButtonElement>('.catalog-pagination button');
  expect(more?.textContent).toContain('加载更多');
  await act(async () => { more!.click(); });
  await vi.waitFor(() => expect(root.textContent).toContain('测试书 15'));
  expect(root.textContent).toContain('已显示 15 本书');
  expect(root.querySelector('.catalog-pagination button')).toBeNull();
});
