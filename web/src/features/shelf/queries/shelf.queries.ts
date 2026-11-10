import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AppRuntime } from '../../../app/runtime.ts';
import { useRuntime } from '../../../app/providers/runtime-context.tsx';
import type { ReadingState } from '../../../api/types.ts';
import type { HomeShelfCount, ShelfSort } from '../../../store/settings.ts';

/**
 * What narrows the shelf besides the search: 在读 / 想读 / 已读, and one 分组 — a
 * series or a tag, the two groupings the books themselves carry.
 */
export interface ShelfFilters { status?: ReadingState; series?: string; tag?: string }

export function shelfQuery(runtime: AppRuntime, page = 1, sort: 'recent' | 'added' | 'title' | 'author' = 'recent', search = '', filters: ShelfFilters = {}) {
  return queryOptions({
    queryKey: ['shelf', runtime.api.baseUrl, runtime.api.currentSession()?.user.id, page, sort, search, filters.status ?? '', filters.series ?? '', filters.tag ?? ''],
    queryFn: ({ signal }) => runtime.api.listBooks({
      scope: 'shelf', page, pageSize: 60, sort, order: sort === 'title' || sort === 'author' ? 'asc' : 'desc', search: search.trim(),
      ...(filters.status ? { status: filters.status } : {}), ...(filters.series ? { series: filters.series } : {}), ...(filters.tag ? { tag: filters.tag } : {}),
    }, { signal }),
  });
}

export function useShelf(page = 1, sort: 'recent' | 'added' | 'title' | 'author' = 'recent', search = '', filters: ShelfFilters = {}) {
  return useQuery(shelfQuery(useRuntime(), page, sort, search, filters));
}

/** 首页「我的书架」: a fixed count from the first page, or every book on the shelf. */
export function homeShelfQuery(runtime: AppRuntime, sort: ShelfSort, count: HomeShelfCount) {
  const order = sort === 'title' || sort === 'author' ? 'asc' : 'desc';
  return queryOptions({
    // Under `home`, so leaving the reader — which invalidates that prefix after
    // the position is saved — refetches this row instead of keeping the order
    // from before the book was opened.
    queryKey: ['home', 'shelf', runtime.api.baseUrl, runtime.api.currentSession()?.user.id, sort, count],
    queryFn: async ({ signal }) => {
      const pageSize = count === 'all' ? 200 : 60;
      const load = (page: number) => runtime.api.listBooks({
        scope: 'shelf', page, pageSize, sort, order, search: '',
      }, { signal });
      const first = await load(1);
      if (count !== 'all') return { ...first, items: first.items.slice(0, count) };
      const items = [...first.items];
      let page = 2;
      // A short page ends the walk: the server has nothing further, and a counter
      // that never reaches `total` must not keep asking.
      while (items.length < first.total && page <= 50) {
        const next = await load(page);
        if (next.items.length === 0) break;
        items.push(...next.items);
        page += 1;
      }
      return { ...first, items };
    },
  });
}

/** Series and tags on this account's shelf: the choices behind 分组. */
export function useShelfGroups(enabled: boolean) {
  const runtime = useRuntime();
  return useQuery({
    queryKey: ['shelf-groups', runtime.api.baseUrl, runtime.api.currentSession()?.user.id],
    queryFn: ({ signal }) => runtime.api.facets({ signal }),
    enabled,
  });
}
