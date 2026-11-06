import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pull-to-refresh on a vertical scroller.
 *
 * Real phones send `pointerType: 'touch'`. Chrome DevTools' device mode often
 * still reports `mouse` while the page is under `(pointer: coarse)` / touch
 * points — treat that as a pull too, so PC mobile debugging works. A plain
 * desktop mouse (fine pointer, no touch points) stays out so text selection is
 * undisturbed. The gesture starts only when the scroll host is at the top and
 * the finger moves clearly downward.
 *
 * `ref` is the event surface (where the finger starts). `scrollRef` is optional:
 * when the page chrome is fixed and only an inner pane scrolls (首页), pass the
 * pane as `scrollRef` so a pull on the greeting still refreshes, but only while
 * that pane is scrolled to the top.
 */
const THRESHOLD = 64;
const MAX_PULL = 104;
/** How much of the raw finger travel becomes visible pull (rubber-band feel). */
const DAMP = 0.42;
const OWNERS = 'input,select,textarea,[contenteditable="true"],[role="slider"]';

export interface PullToRefreshState {
  /** Pixels the indicator is open (0 when idle). */
  distance: number;
  refreshing: boolean;
  /** Finger has passed the release threshold. */
  armed: boolean;
}

/** True for a finger, or a mouse used inside a touch/coarse (DevTools phone) viewport. */
export function isPullPointer(event: Pick<PointerEvent, 'pointerType' | 'isPrimary'>): boolean {
  if (!event.isPrimary) return false;
  if (event.pointerType === 'touch' || event.pointerType === 'pen') return true;
  if (event.pointerType !== 'mouse') return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return true;
  } catch { /* optional */ }
  return false;
}

function ownsGesture(path: EventTarget[], root: HTMLElement): boolean {
  for (const node of path) {
    if (node === root) return false;
    if (!(node instanceof HTMLElement)) continue;
    if (node.matches(OWNERS)) return true;
  }
  return false;
}

function damp(dy: number): number {
  return Math.min(MAX_PULL, Math.max(0, dy) * DAMP);
}

/**
 * Returns callback refs for the event surface (and optional scroll host), plus
 * the live pull state used to render {@link PullRefreshIndicator}.
 */
export function usePullToRefresh(onRefresh: () => Promise<void>): PullToRefreshState & {
  /** Element that receives pointer events (often the page or the scroller). */
  ref: (element: HTMLElement | null) => void;
  /** When set, its `scrollTop` gates the gesture instead of `ref`'s. */
  scrollRef: (element: HTMLElement | null) => void;
} {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);
  const detach = useRef<(() => void) | null>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const scrollHostRef = useRef<HTMLElement | null>(null);
  const live = useRef({ distance: 0, refreshing: false });

  const scrollTop = () => (scrollHostRef.current ?? surfaceRef.current)?.scrollTop ?? 0;

  const bind = useCallback(() => {
    detach.current?.();
    detach.current = null;
    const element = surfaceRef.current;
    if (!element) return;

    let start: { x: number; y: number; id: number } | null = null;
    let tracking = false;

    const setPull = (next: number) => {
      live.current.distance = next;
      setDistance(next);
      element.style.setProperty('--pull-distance', `${next}px`);
    };

    const finish = async (shouldRefresh: boolean) => {
      tracking = false;
      start = null;
      if (!shouldRefresh || live.current.refreshing) {
        setPull(0);
        return;
      }
      live.current.refreshing = true;
      setRefreshing(true);
      setPull(THRESHOLD);
      try {
        await onRefreshRef.current();
      } catch {
        // The refresh callback owns the error toast; never leave the gesture hanging.
      } finally {
        live.current.refreshing = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    const down = (event: PointerEvent) => {
      start = null;
      tracking = false;
      if (live.current.refreshing) return;
      if (!isPullPointer(event)) return;
      if (scrollTop() > 1) return;
      if (ownsGesture(event.composedPath(), element)) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };

    const move = (event: PointerEvent) => {
      if (!start || start.id !== event.pointerId || live.current.refreshing) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!tracking) {
        if (dy < 8) return;
        // A sideways swipe belongs to the tab gesture, not pull-to-refresh.
        if (Math.abs(dx) > Math.abs(dy) * 0.7) {
          start = null;
          return;
        }
        if (scrollTop() > 1) {
          start = null;
          return;
        }
        tracking = true;
        try { element.setPointerCapture(event.pointerId); } catch { /* optional */ }
      }
      if (dy <= 0) {
        setPull(0);
        return;
      }
      if (event.cancelable) event.preventDefault();
      setPull(damp(dy));
    };

    const up = (event: PointerEvent) => {
      if (!start || start.id !== event.pointerId) return;
      const shouldRefresh = tracking && live.current.distance >= THRESHOLD;
      void finish(shouldRefresh);
    };

    const cancel = (event: PointerEvent) => {
      if (!start || start.id !== event.pointerId) return;
      void finish(false);
    };

    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move, { passive: false });
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
    detach.current = () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
      element.style.removeProperty('--pull-distance');
    };
  }, []);

  const ref = useCallback((element: HTMLElement | null) => {
    surfaceRef.current = element;
    bind();
  }, [bind]);

  const scrollRef = useCallback((element: HTMLElement | null) => {
    scrollHostRef.current = element;
  }, []);

  return {
    ref,
    scrollRef,
    distance,
    refreshing,
    armed: distance >= THRESHOLD && !refreshing,
  };
}
