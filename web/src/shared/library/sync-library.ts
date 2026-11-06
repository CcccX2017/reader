import type { QueryClient } from '@tanstack/react-query';
import type { ReaderApi } from '../../api/client.ts';
import { notify } from '../../ui/notifications.ts';

/**
 * One manual library sync: scan the mount, then refetch every list that shows
 * books. `scanLibrary` already drops the transport GET cache for books/browse;
 * this then refetches the React Query screens. The pull indicator covers "in
 * progress"; only the outcome is toasted.
 */
export async function syncLibraryOnce(api: ReaderApi, queryClient: QueryClient): Promise<void> {
  try {
    const result = await api.scanLibrary();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['shelf'] }),
      queryClient.invalidateQueries({ queryKey: ['shelf-groups'] }),
      queryClient.invalidateQueries({ queryKey: ['library-books'] }),
      queryClient.invalidateQueries({ queryKey: ['library-browse'] }),
      queryClient.invalidateQueries({ queryKey: ['library-files'] }),
      queryClient.invalidateQueries({ queryKey: ['home'] }),
    ]);
    const parts = [
      result.added ? `新增 ${result.added} 本` : '',
      result.updated ? `更新 ${result.updated} 本` : '',
      result.removed ? `移除 ${result.removed} 本` : '',
    ].filter(Boolean);
    notify(parts.length ? `书库已同步 · ${parts.join(' · ')}` : '书库已同步 · 无变化', { kind: 'success' });
  } catch (reason) {
    notify(reason instanceof Error ? reason.message : '书库同步失败，请重试', { kind: 'error' });
    throw reason;
  }
}
