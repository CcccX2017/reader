import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type JSX, type MouseEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import type { MenuItems } from './action-menu.tsx';
import { ActionMenu, ActionSheet } from './action-menu.tsx';
import { Icon } from './icon.tsx';

/** Keep a just-selected cover clear of the fixed `.shelf-select-bar`. */
function revealCardAboveSelectBar(card: HTMLElement | null): void {
  if (!card) return;
  const run = () => {
    const bar = document.querySelector('.shelf-select-bar');
    const limit = bar instanceof HTMLElement
      ? bar.getBoundingClientRect().top - 12
      : window.innerHeight - 12;
    const rect = card.getBoundingClientRect();
    if (rect.bottom <= limit) return;
    const delta = rect.bottom - limit;
    const scroller = card.closest('.shelf-scroll, .library-browse-scroll, .home-shelf-scroll');
    if (scroller instanceof HTMLElement) scroller.scrollTop += delta;
    else window.scrollBy(0, delta);
  };
  // Wait for the bar + `data-selecting` padding to land before measuring.
  requestAnimationFrame(() => requestAnimationFrame(run));
}

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
 * The click that the browser fires after the hold must not open the book —
 * and must not toggle the same book straight back off.
 */
export function useHoldToSelect(onSelect: () => void, enabled: boolean) {
  const suppress = useRef(false);
  const timer = useRef(0);
  const clearSuppress = useRef(0);
  const ready = useRef(false);
  /** Selection already applied while the finger is still down. */
  const committed = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  useEffect(() => () => {
    stop.current?.();
    window.clearTimeout(clearSuppress.current);
  }, []);

  const armSuppress = () => {
    suppress.current = true;
    window.clearTimeout(clearSuppress.current);
    clearSuppress.current = window.setTimeout(() => { suppress.current = false; }, 700);
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    if (!enabled || event.pointerType === 'mouse') return;
    const startX = event.clientX;
    const startY = event.clientY;
    stop.current?.();
    ready.current = false;
    committed.current = false;
    const finish = (commit: boolean) => {
      // Timer may already have selected; release then only keeps the click lock.
      const shouldFire = commit && ready.current && !committed.current;
      const keepSuppress = committed.current || shouldFire;
      ready.current = false;
      window.clearTimeout(timer.current);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', abort);
      stop.current = null;
      if (keepSuppress) armSuppress();
      if (!shouldFire) return;
      committed.current = true;
      onSelectRef.current();
    };
    const move = (ev: PointerEvent) => {
      // Entering selection swaps chrome and can shift the card under the finger.
      // That is not a scroll cancel once the book is already selected.
      if (committed.current) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 24) finish(false);
    };
    const up = () => finish(true);
    const abort = () => finish(false);
    stop.current = () => finish(false);
    timer.current = window.setTimeout(() => {
      ready.current = true;
      committed.current = true;
      try { navigator.vibrate?.(12); } catch { /* optional */ }
      armSuppress();
      onSelectRef.current();
    }, 450);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', abort);
  };

  const onClickCapture = (event: MouseEvent) => {
    if (!suppress.current) return;
    // Keep suppress armed: a reflow under the finger can emit more than one click,
    // and clearing on the first one let the second toggle the book off mid-hold.
    event.preventDefault();
    event.stopPropagation();
  };

  const onContextMenu = (event: MouseEvent) => {
    if (!enabled) return;
    event.preventDefault();
  };

  const onDragStart = (event: DragEvent) => {
    // A long-press must not lift the cover as a native drag image.
    event.preventDefault();
  };

  return { onPointerDown, onClickCapture, onContextMenu, onDragStart };
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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const wasActive = useRef(false);
  const hold = useHoldToSelect(() => picking?.onHold(), !!picking && !picking.active);
  useLayoutEffect(() => {
    const active = !!picking?.active;
    // Only the book that opened selection needs lifting; wait for the finger to lift
    // so a mid-hold scroll does not yank the cover out from under the contact.
    const shouldReveal = active && !!picking?.selected && !wasActive.current;
    wasActive.current = active;
    if (!shouldReveal) return;
    const card = cardRef.current;
    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      revealCardAboveSelectBar(card);
    };
    window.addEventListener('pointerup', reveal);
    window.addEventListener('pointercancel', reveal);
    const fallback = window.setTimeout(reveal, 500);
    return () => {
      window.removeEventListener('pointerup', reveal);
      window.removeEventListener('pointercancel', reveal);
      window.clearTimeout(fallback);
    };
  }, [picking?.active, picking?.selected]);
  const onClickCapture = (event: MouseEvent) => {
    hold.onClickCapture(event);
    if (event.defaultPrevented || !picking?.active) return;
    event.preventDefault();
    event.stopPropagation();
    picking.onToggle();
  };
  const onContextMenu = (event: MouseEvent) => { if (picking) event.preventDefault(); };
  const onDragStart = (event: DragEvent) => { event.preventDefault(); };
  const selected = !!picking?.selected;
  const setCardRef: Ref<HTMLDivElement> = (node) => { cardRef.current = node; };
  return {
    selected,
    props: picking ? {
      ref: setCardRef,
      ...(picking.active ? {} : hold),
      onClickCapture,
      onContextMenu,
      onDragStart,
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
