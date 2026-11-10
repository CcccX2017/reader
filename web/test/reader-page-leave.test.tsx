// @vitest-environment jsdom
import { act } from 'react';
import { flushSync } from 'react-dom';
import { expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '../src/shared/ui/render-root.ts';
import { RuntimeContext } from '../src/app/providers/runtime-context.tsx';

/** #663: back on 首页 or the shelf after reading, the progress shown is the one just read. */
const order: string[] = [];
const warnings: string[] = [];
vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
  warnings.push(String(message));
});
vi.mock('../src/ui/reader-screen.tsx', () => ({
  ReaderScreen: class {
    element = document.createElement('div');
    // The real screen flushes its chrome root from the constructor. Doing it
    // here is what fails if that construction is still inside the passive effect.
    constructor() { flushSync(() => { this.element.textContent = 'reader'; }); }
    open() { return Promise.resolve(); }
    flushProgress() { order.push('save'); return Promise.resolve(); }
    dispose() { order.push('dispose'); }
  },
}));
const { ReaderPage } = await import('../src/features/reader/pages/ReaderPage.tsx');

it('pushes the position and re-reads 首页 and the shelf when the reader closes', async () => {
  const invalidated: unknown[] = [];
  const runtime = {
    api: { getBook: async () => ({ book: { id: 'b1', title: '书', format: 'epub' } }) },
    offline: { flush: async () => { order.push('offline'); }, books: () => [] },
    sync: { flush: async () => { order.push('sync'); } },
    queryClient: { invalidateQueries: async (filter: { queryKey: unknown[] }) => { invalidated.push(filter.queryKey[0]); } },
    mediaApi: { preferenceScope: () => 'scope' },
    settings: { current: {} },
    platform: {},
    registerReader: () => () => undefined,
    updateSettings: async () => undefined,
  } as any;
  const root = document.createElement('div');
  await act(async () => render(
    <RuntimeContext.Provider value={runtime}>
      <MemoryRouter initialEntries={['/book/b1']}><Routes><Route path="/book/:bookId" element={<ReaderPage />} /></Routes></MemoryRouter>
    </RuntimeContext.Provider>, root));
  expect(root.querySelector('.reader-route-host')?.textContent).toBe('reader');
  expect(warnings.join('\n')).not.toContain('flushSync was called from inside a lifecycle method');
  await act(async () => render(null, root));
  await vi.waitFor(() => expect(invalidated).toEqual(['home', 'shelf']));
  expect(order).toEqual(['save', 'dispose', 'offline', 'sync']);
});
