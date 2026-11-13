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
const searchSource = vi.fn(async function* () {
  yield { items: [{ ref: 'hit', title: '命中的书' }] };
});
const runtime = {
  api: {
    baseUrl: 'https://reader.example',
    currentSession: () => null,
    sources: vi.fn(async () => [source]),
    sourceTypes: vi.fn(async () => []),
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
  searchSource.mockClear();
});

afterEach(() => {
  act(() => render(null, root));
  client.clear();
});

it('clears the search results when the search box is emptied', async () => {
  await paint();
  await vi.waitFor(() => expect(keyword()).toBeTruthy());
  await act(async () => { typeInto(keyword(), '红楼'); });
  await act(async () => { keyword().form!.requestSubmit(); });
  await vi.waitFor(() => expect(root.textContent).toContain('命中的书'));
  await act(async () => { typeInto(keyword(), ''); });
  await vi.waitFor(() => expect(root.textContent).not.toContain('命中的书'));
  expect(keyword().value).toBe('');
});
