import { useEffect, useRef, useState, type JSX, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { MenuItems } from './action-menu.tsx';
import { ActionMenu, ActionSheet } from './action-menu.tsx';
import { Icon } from './icon.tsx';

function coarseNow(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Touch-first layout. A mouse stays on the ⋯ lens. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(coarseNow);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    let query: MediaQueryList;
    try { query = matchMedia('(pointer: coarse)'); } catch { return; }
    const onChange = () => setCoarse(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return coarse;
}

/**
 * Long-press a book on a phone: a short hold selects it, a scroll cancels.
 * The click that the browser fires after the hold must not open the book.
 */
export function useHoldToSelect(onSelect: () => void, enabled: boolean) {
  const suppress = useRef(false);
  const timer = useRef(0);
  const ready = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = (event: ReactPointerEvent) => {
    if (!enabled || event.pointerType === 'mouse') return;
    const startX = event.clientX;
    const startY = event.clientY;
    stop.current?.();
    ready.current = false;
    const finish = (commit: boolean) => {
      const fire = commit && ready.current;
      ready.current = false;
      window.clearTimeout(timer.current);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', abort);
      stop.current = null;
      if (!fire) return;
      // The sheet opens after the finger lifts, so the release cannot land on a row.
      suppress.current = true;
      window.setTimeout(() => { suppress.current = false; }, 700);
      onSelectRef.current();
    };
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 24) finish(false);
    };
    const up = () => finish(true);
    const abort = () => finish(false);
    stop.current = () => finish(false);
    timer.current = window.setTimeout(() => {
      ready.current = true;
      try { navigator.vibrate?.(12); } catch { /* optional */ }
      // Select while the finger is still down. The click the browser sends on
      // release has to be swallowed, or it toggles the same book straight off.
      suppress.current = true;
      window.setTimeout(() => { suppress.current = false; }, 700);
      onSelectRef.current();
    }, 450);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', abort);
  };

  const onClickCapture = (event: MouseEvent) => {
    if (!suppress.current) return;
    suppress.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onContextMenu = (event: MouseEvent) => {
    if (!enabled) return;
    event.preventDefault();
  };

  return { onPointerDown, onClickCapture, onContextMenu };
}

/** The round check on a selected cover's bottom-right. */
export function CoverCheck() {
  return <span className="book-selected" role="img" aria-label="已选中"><Icon name="check" size={18} strong /></span>;
}

/** An unchecked box: a clear ring and check, so the cover shows through. A picked book keeps the solid check. */
export function CoverMark({ selected }: { selected: boolean }) {
  if (selected) return <CoverCheck />;
  return <span className="book-check" role="img" aria-label="未选中"><Icon name="check" size={18} strong /></span>;
}

/** Phone multi-select on a cover. Absent while a pointer is using the corner menu. */
export interface Picking {
  active: boolean;
  selected: boolean;
  onHold(): void;
  onToggle(): void;
}

/** Long-press starts selection; a tap while it is open toggles the book and does not open it. */
export function usePickingCard(picking: Picking | undefined) {
  const hold = useHoldToSelect(() => picking?.onHold(), !!picking && !picking.active);
  const onClickCapture = (event: MouseEvent) => {
    hold.onClickCapture(event);
    if (event.defaultPrevented || !picking?.active) return;
    event.preventDefault();
    event.stopPropagation();
    picking.onToggle();
  };
  const onContextMenu = (event: MouseEvent) => { if (picking) event.preventDefault(); };
  const selected = !!picking?.selected;
  return {
    selected,
    props: picking ? {
      ...(picking.active ? {} : hold),
      onClickCapture,
      onContextMenu,
      role: picking.active ? 'checkbox' as const : undefined,
      'aria-checked': picking.active ? picking.selected : undefined,
      'data-selected': selected ? 'true' as const : undefined,
    } : {},
    mark: picking?.active ? <CoverMark selected={selected} /> : null,
  };
}

/** Desktop keeps the corner lens. A phone hides it and opens the same actions from a long press. */
export function useCoverActions(title: string, items: MenuItems | undefined): {
  selected: boolean;
  hold: ReturnType<typeof useHoldToSelect> | Record<string, never>;
  menu: JSX.Element | null;
  sheet: JSX.Element | null;
  /** A round check on the cover's bottom-right while the book is the one selected. */
  mark: JSX.Element | null;
} {
  const coarse = useCoarsePointer();
  const [selected, setSelected] = useState(false);
  useEffect(() => { if (!coarse) setSelected(false); }, [coarse]);
  const enabled = coarse && !!items?.some(Boolean);
  const hold = useHoldToSelect(() => setSelected(true), enabled);
  const heading = `《${title}》`;
  const menu = !coarse && items
    ? <ActionMenu glass className="book-more" label={`${title} 的操作`} title={heading} items={items} />
    : null;
  const sheet = selected && items
    ? <ActionSheet title={heading} items={items.map(item => item ? { ...item, onSelect: () => { setSelected(false); item.onSelect(); } } : item)} onDismiss={() => setSelected(false)} />
    : null;
  const mark = selected ? <CoverCheck /> : null;
  return { selected, hold: enabled ? hold : {}, menu, sheet, mark };
}
