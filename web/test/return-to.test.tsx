// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';
import { useAuthStore } from '../src/shared/stores/auth.store.ts';
import { LibraryBrowsePage } from '../src/features/library/pages/LibraryPage.tsx';
import { SourcesPage } from '../src/features/sources/pages/SourcesPage.tsx';

const root = document.createElement('div');
document.body.append(root);
const runtime = {
  api: {
    baseUrl: 'https://reader.example',
    currentSession: () => null,
    browse: vi.fn(async () => ({ crumbs: [{ name: '书库', path: '' }], entries: [], writable: false, page: 1, pageSize: 200, total: 0 })),
    listBooks: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 60 })),
    sources: vi.fn(async () => []),
    sourceTypes: vi.fn(async () => []),
  },
} as never;
let client: QueryClient;

function paint(page: 'library' | 'sources', state?: unknown) {
  const path = page === 'library' ? '/library' : '/sources';
  const element = page === 'library' ? <LibraryBrowsePage /> : <SourcesPage />;
  return act(async () => render(
    <RuntimeContext value={runtime}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[{ pathname: path, state }]}>{element}</MemoryRouter>
      </QueryClientProvider>
    </RuntimeContext>,
    root,
  ));
}

function backHref() {
  return root.querySelector<HTMLAnchorElement>('a[aria-label="返回"]')?.getAttribute('href');
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ session: null, verifiedUser: null });
});

afterEach(() => {
  act(() => render(null, root));
});

describe('书库和书源的返回', () => {
  it('书库回到打开它的那一页', async () => {
    await paint('library', { returnTo: '/me' });
    expect(backHref()).toBe('/me');
  });

  it('书源回到打开它的那一页', async () => {
    await paint('sources', { returnTo: '/shelf?page=2' });
    expect(root.textContent).toContain('书源与追更');
    expect(backHref()).toBe('/shelf?page=2');
  });

  it('直接打开时回到书架，并丢掉站外地址', async () => {
    await paint('library');
    expect(backHref()).toBe('/shelf');
    await paint('sources', { returnTo: '//evil.example' });
    expect(backHref()).toBe('/shelf');
  });
});
