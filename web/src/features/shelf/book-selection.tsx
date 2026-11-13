import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type JSX } from 'react';
import type { ReadingState } from '../../api/types.ts';
import { useRuntime } from '../../app/providers/runtime-context.tsx';
import { useAuthStore } from '../../shared/stores/auth.store.ts';
import type { MenuItems } from '../../ui/action-menu.tsx';
import { DialogView, type Dialog } from '../../ui/dialog.tsx';
import type { IconName } from '../../ui/icon.tsx';
import type { Picking } from '../../ui/cover-actions.tsx';
import { FloatingNotice } from '../../ui/floating-notice.tsx';
import { notify } from '../../ui/notifications.ts';
import { describeShelfAction, SHELF_ACTION_LABELS } from '../../ui/shelf-membership.ts';
import { Icon } from '../../ui/toolkit.tsx';
import { useBookMetadata } from './book-metadata.tsx';
import { useCustomCover } from './custom-cover.tsx';

export const READING_LABELS: Record<ReadingState, string> = { reading: '在读', want: '想读', finished: '已读' };
export const READING_STATES = ['reading', 'want', 'finished'] as const;

/** A book the selection bar can act on. `shelfState` is omitted on the shelf, where every book is on it. */
export interface SelectableBook {
  id: string;
  title: string;
  author?: string;
  format?: string | null;
  readingState?: ReadingState | null;
  manualFields?: string[];
  shelfState?: 'on' | 'off';
}

export interface SelectAction {
  label: string;
  icon: IconName;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

const onShelf = (book: SelectableBook) => book.shelfState !== 'off';

/**
 * Phone selection shared by 书架, 首页 and 书库.
 *
 * `null` is browsing. An array, even an empty one, is the selection screen.
 * `resetKey` drops the selection when the list the reader is looking at changes.
 *
 * Pages keep the browsing header in layout (hidden) and overlay `BookSelectHead`,
 * and pin `BookSelectBar` with `position: fixed`, so entering selection does not
 * shove the grid under a still-down finger.
 */
export function useBookPicking<T extends { id: string }>(books: T[], resetKey: unknown) {
  const [picked, setPicked] = useState<string[] | null>(null);
  useEffect(() => { setPicked(null); }, [resetKey]);
  const chosen = useMemo(() => picked === null ? [] : books.filter(book => picked.includes(book.id)), [picked, books]);
  const allPicked = books.length > 0 && books.every(book => picked?.includes(book.id));
  const bind = (book: T): Picking => ({
    active: picked !== null,
    selected: picked?.includes(book.id) ?? false,
    onHold: () => setPicked(ids => ids?.includes(book.id) ? ids : [...(ids ?? []), book.id]),
    onToggle: () => setPicked(ids => ids?.includes(book.id) ? ids.filter(id => id !== book.id) : [...(ids ?? []), book.id]),
  });
  return {
    active: picked !== null,
    chosen,
    allPicked,
    count: chosen.length,
    finish: () => setPicked(null),
    cancel: () => setPicked(null),
    selectAll: () => setPicked(ids => books.length > 0 && books.every(book => ids?.includes(book.id)) ? [] : books.map(book => book.id)),
    bind,
  };
}

/** The same book actions on every screen: marks, cover, shelf membership, and admin delete. */
export function useBookCommands(finish: () => void) {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const admin = useAuthStore(state => state.verifiedUser?.role === 'admin');
  const [error, setError] = useState('');
  const [removeTargets, setRemoveTargets] = useState<SelectableBook[] | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<SelectableBook[] | null>(null);
  const covers = useCustomCover(setError);
  const metadata = useBookMetadata(setError);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['shelf'] });
    await queryClient.invalidateQueries({ queryKey: ['shelf-groups'] });
    await queryClient.invalidateQueries({ queryKey: ['library-books'] });
    await queryClient.invalidateQueries({ queryKey: ['library-files'] });
    await queryClient.invalidateQueries({ queryKey: ['library-browse'] });
    await queryClient.invalidateQueries({ queryKey: ['home'] });
    await queryClient.invalidateQueries({ queryKey: ['search'] });
  };

  const mark = async (books: SelectableBook[], state: ReadingState | null) => {
    const targets = books.filter(onShelf);
    if (!targets.length) return;
    setError('');
    try {
      await Promise.all(targets.map(book => runtime.api.setReadingStatus(book.id, state)));
      await invalidate();
      finish();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '标记失败，请稍后重试。'); }
  };

  const shelve = async (books: SelectableBook[], action: 'add' | 'remove') => {
    if (!books.length) return;
    setError('');
    try {
      const result = await runtime.api.browseBatchShelf({ bookIds: books.map(book => book.id) }, action);
      await invalidate();
      notify(describeShelfAction(action, result), { kind: result.applied ? 'success' : 'error' });
      finish();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `${SHELF_ACTION_LABELS[action]}失败，请稍后重试。`); }
  };

  const erase = async (books: SelectableBook[]) => {
    setError('');
    try {
      const ids = books.map(book => book.id);
      const result = await runtime.api.deleteLibraryBooks(ids);
      const kept = new Set(result.failed.filter(item => item.reason !== 'NOT_FOUND').map(item => item.id));
      const gone = ids.filter(id => !kept.has(id));
      if (gone.length) await runtime.offline.removeBooks(gone);
      await invalidate();
      finish();
      notify(result.deleted ? `已删除 ${result.deleted} 本${result.failed.length ? `，${result.failed.length} 本失败` : ''}` : '没有删除任何书', { kind: result.deleted && !result.failed.length ? 'success' : 'error' });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败，请稍后重试。'); }
  };

  const menuFor = (book: SelectableBook): MenuItems => [
    ...(onShelf(book) ? READING_STATES.filter(state => state !== book.readingState).map(state => ({ label: '标记为' + READING_LABELS[state], onSelect: () => void mark([book], state) })) : []),
    onShelf(book) && book.readingState && { label: '清除标记', onSelect: () => void mark([book], null) },
    ...metadata.menu(book),
    ...covers.menu(book),
    book.shelfState === 'off'
      ? { label: SHELF_ACTION_LABELS.add, onSelect: () => void shelve([book], 'add') }
      : { label: SHELF_ACTION_LABELS.remove, danger: true, onSelect: () => setRemoveTargets([book]) },
    admin && { label: '删除', danger: true, onSelect: () => setDeleteTargets([book]) },
  ];

  const actionsFor = (chosen: SelectableBook[]): SelectAction[] => {
    const present = chosen.filter(onShelf);
    const absent = chosen.filter(book => book.shelfState === 'off');
    const one = chosen.length === 1 ? chosen[0] : undefined;
    return [
      { label: '在读', icon: 'book', disabled: !present.length, onSelect: () => void mark(present, 'reading') },
      { label: '想读', icon: 'bookmark', disabled: !present.length, onSelect: () => void mark(present, 'want') },
      { label: '已读', icon: 'check', disabled: !present.length, onSelect: () => void mark(present, 'finished') },
      { label: '编辑信息', icon: 'edit', disabled: !one || metadata.busy, onSelect: () => { if (one) metadata.open(one); } },
      { label: '设置封面', icon: 'upload', disabled: !one || covers.busy, onSelect: () => { if (one) covers.open(one); } },
      { label: '清除标记', icon: 'close', disabled: !present.length, onSelect: () => void mark(present, null) },
      { label: '恢复封面', icon: 'refresh', disabled: !one || !one.manualFields?.includes('cover') || covers.busy, onSelect: () => { if (one) void covers.clear(one.id); } },
      ...(absent.length ? [{ label: SHELF_ACTION_LABELS.add, icon: 'plus' as const, disabled: false, onSelect: () => void shelve(absent, 'add') }] : []),
      { label: SHELF_ACTION_LABELS.remove, icon: 'eye-off', danger: true, disabled: !present.length, onSelect: () => setRemoveTargets(present) },
      ...(admin ? [{ label: '删除', icon: 'trash' as const, danger: true, disabled: !chosen.length, onSelect: () => setDeleteTargets(chosen) }] : []),
    ];
  };

  const ui: JSX.Element = <>
    <FloatingNotice message={error} error />
    {covers.input}
    {covers.ui}
    {metadata.ui}
    {removeTargets && <DialogView dialog={{ kind: 'confirm', title: SHELF_ACTION_LABELS.remove, body: removeTargets.length === 1 ? `《${removeTargets[0]?.title || '未命名'}》会从你的书架上消失，书库里的文件不受影响，之后可以在书库重新加入。` : `这 ${removeTargets.length} 本会从你的书架上消失，书库里的文件不受影响，之后可以在书库重新加入。`, resolve: (_answer: boolean) => undefined } satisfies Dialog} destructive={SHELF_ACTION_LABELS.remove} onClose={answer => { const targets = removeTargets; setRemoveTargets(null); if (answer === true) void shelve(targets, 'remove'); }} />}
    {deleteTargets && <DialogView dialog={{ kind: 'confirm', title: '删除', body: deleteTargets.length === 1 ? `《${deleteTargets[0]?.title || '未命名'}》的文件会从书库删除，阅读进度、笔记和封面也不会保留，无法恢复。` : `这 ${deleteTargets.length} 本的文件会从书库删除，阅读进度、笔记和封面也不会保留，无法恢复。`, resolve: (_answer: boolean) => undefined } satisfies Dialog} destructive="删除" onClose={answer => { const targets = deleteTargets; setDeleteTargets(null); if (answer === true) void erase(targets); }} />}
  </>;

  return { covers, menuFor, actionsFor, ui };
}

export function BookSelectHead({ allPicked, count, onAll, onCancel }: { allPicked: boolean; count: number; onAll(): void; onCancel(): void }) {
  return <header className="shelf-head shelf-select-head">
    <button type="button" className="shelf-select-side" onClick={onAll}>{allPicked ? '取消全选' : '全选'}</button>
    <div className="shelf-select-title"><strong>选择书籍</strong><span>已选择 {count} 本</span></div>
    <button type="button" className="shelf-select-side" onClick={onCancel}>取消</button>
  </header>;
}

export function BookSelectBar({ actions }: { actions: SelectAction[] }) {
  // Cover the phone tab bar while selecting: the toolbar sits at the same bottom
  // edge, and the nav must not accept taps or route changes underneath it.
  useEffect(() => {
    document.body.dataset['bookSelecting'] = 'true';
    const nav = document.querySelector('.app-nav');
    if (nav instanceof HTMLElement) {
      nav.setAttribute('inert', '');
      nav.setAttribute('aria-hidden', 'true');
    }
    return () => {
      delete document.body.dataset['bookSelecting'];
      if (nav instanceof HTMLElement) {
        nav.removeAttribute('inert');
        nav.removeAttribute('aria-hidden');
      }
    };
  }, []);
  return <div className="shelf-select-bar" role="toolbar" aria-label="已选书籍的操作">{actions.map(action => <button key={action.label} type="button" className="shelf-select-action" data-danger={action.danger ? 'true' : undefined} disabled={action.disabled} onClick={action.onSelect}><Icon name={action.icon} size={24} /><span>{action.label}</span></button>)}</div>;
}
