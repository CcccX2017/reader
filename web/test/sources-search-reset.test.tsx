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
  id: 'legado', pluginId: 'legado', sourceType: 'legado', name: '发现', enabled: true, isDefault: true,
  descriptor: { id: 'legado', pluginId: 'legado', label: 'Legado', version: '1', builtin: false, capabilities: ['search', 'browse'] },
};
const sourceCatalog = vi.fn(async () => ({ items: [{ ref: 'all', title: '全书甲' }] }));
const searchSource = vi.fn(async function* () {
  yield { items: [{ ref: 'hit', title: '命中的书' }] };
});
const runtime = {
  api: {
    baseUrl: 'https://reader.example',
    currentSession: () => null,
    sources: vi.fn(async () => [source]),
    sourceTypes: vi.fn(async () => []),
    sourceCatalog,
    searchSource,
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
  sourceCatalog.mockClear();
  searchSource.mockClear();
});

afterEach(() => {
  act(() => render(null, root));
  client.clear();
});

async function searchFor(text: string) {
  await paint();
  await vi.waitFor(() => expect(root.textContent).toContain('全书甲'));
  await act(async () => { typeInto(keyword(), text); });
  await act(async () => { keyword().form!.requestSubmit(); });
  await vi.waitFor(() => expect(root.textContent).toContain('命中的书'));
  expect(root.textContent).not.toContain('全书甲');
}

it('lists the whole directory again when the search box is cleared', async () => {
  await searchFor('红楼');
  expect(root.querySelector('button[aria-label="清除搜索"]')).toBeNull();
  await act(async () => { typeInto(keyword(), ''); });
  await vi.waitFor(() => expect(root.textContent).toContain('全书甲'));
  expect(root.textContent).not.toContain('命中的书');
  expect(keyword().value).toBe('');
  expect(sourceCatalog).toHaveBeenCalledTimes(2);
});
