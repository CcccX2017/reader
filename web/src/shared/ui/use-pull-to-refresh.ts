import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pull-to-refresh on a vertical scroller.
 *
 * Phones need non-passive `touchmove` + `preventDefault`: `pointermove`'s
 * preventDefault does not cancel the browser's scroll/overscroll, so a real
 * device never shows the cue that DevTools (mouse → pointer) does. Mouse /
 * DevTools still go through pointer events; touch-typed pointer events are
 * ignored so one gesture is not handled twice.
 *
 * `ref` is the event surface. `scrollRef` is optional: when the page chrome is
 * fixed and only an inner pane scrolls (首页), pass that pane so a pull on the
 * greeting still refreshes, but only while the pane is at the top. Touch
 * listeners are also attached to that pane — WebKit only honours
 * `preventDefault` reliably on the element that would otherwise scroll.
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

function touchPoint(event: TouchEvent): { x: number; y: number; id: number } | null {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) return null;
  return { x: touch.clientX, y: touch.clientY, id: touch.identifier };
}

/**
 * Returns callback refs for the event surface (and optional scroll host), plus
 * the live pull state used to render {@link PullRefreshIndicator}.
 */
export function usePullToRefresh(onRefresh: () => Promise<void>): PullToRefreshState & {
  /** Element that receives pointer/touch events (often the page or the scroller). */
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
    const scrollHost = scrollHostRef.current;
    // Touch must reach the scroller itself on WebKit; pointer stays on the surface.
    const touchRoots = scrollHost && scrollHost !== element ? [element, scrollHost] : [element];

    let start: { x: number; y: number; id: number } | null = null;
    let tracking = false;
    /** 'touch' | 'pointer' — which stream owns the in-flight gesture. */
    let stream: 'touch' | 'pointer' | null = null;

    const setPull = (next: number) => {
      live.current.distance = next;
      setDistance(next);
      element.style.setProperty('--pull-distance', `${next}px`);
      element.dataset['pulling'] = next > 0 || live.current.refreshing ? 'true' : 'false';
      if (scrollHost) scrollHost.dataset['pulling'] = element.dataset['pulling'];
    };

    const finish = async (shouldRefresh: boolean) => {
      tracking = false;
      start = null;
      stream = null;
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

    const begin = (x: number, y: number, id: number, path: EventTarget[], kind: 'touch' | 'pointer') => {
      start = null;
      tracking = false;
      stream = null;
      if (live.current.refreshing) return;
      if (scrollTop() > 1) return;
      if (ownsGesture(path, element)) return;
      start = { x, y, id };
      stream = kind;
    };

    const move = (x: number, y: number, id: number, event: Event) => {
      if (!start || start.id !== id || live.current.refreshing) return;
      const dx = x - start.x;
      const dy = y - start.y;
      if (!tracking) {
        if (dy <= 0) return;
        // A sideways swipe belongs to the tab gesture, not pull-to-refresh.
        if (Math.abs(dx) > Math.abs(dy) * 0.7) {
          start = null;
          stream = null;
          return;
        }
        if (scrollTop() > 1) {
          start = null;
          stream = null;
          return;
        }
        // Claim the gesture before the browser starts scrolling — after that,
        // touchmove is often not cancelable and the cue never appears on phones.
        if (event.cancelable) event.preventDefault();
        if (dy < 8) return;
        tracking = true;
      }
      if (dy <= 0) {
        setPull(0);
        return;
      }
      if (event.cancelable) event.preventDefault();
      setPull(damp(dy));
    };

    const end = (id: number) => {
      if (!start || start.id !== id) return;
      const shouldRefresh = tracking && live.current.distance >= THRESHOLD;
      void finish(shouldRefresh);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (stream === 'touch' && start) return; // already tracking on the other root
      if (event.touches.length !== 1) return;
      const point = touchPoint(event);
      if (!point) return;
      begin(point.x, point.y, point.id, event.composedPath(), 'touch');
    };

    const onTouchMove = (event: TouchEvent) => {
      if (stream !== 'touch' || !start) return;
      let touch: Touch | undefined;
      for (let i = 0; i < event.touches.length; i += 1) {
        if (event.touches[i]!.identifier === start.id) {
          touch = event.touches[i];
          break;
        }
      }
      if (!touch) return;
      move(touch.clientX, touch.clientY, touch.identifier, event);
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (stream !== 'touch' || !start) return;
      let ended = false;
      for (let i = 0; i < event.changedTouches.length; i += 1) {
        if (event.changedTouches[i]!.identifier === start.id) ended = true;
      }
      if (ended) end(start.id);
    };

    const onTouchCancel = (event: TouchEvent) => {
      if (stream !== 'touch' || !start) return;
      for (let i = 0; i < event.changedTouches.length; i += 1) {
        if (event.changedTouches[i]!.identifier === start.id) {
          void finish(false);
          return;
        }
      }
    };

    // Mouse / DevTools only — phones use the touch stream above.
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (!isPullPointer(event)) return;
      begin(event.clientX, event.clientY, event.pointerId, event.composedPath(), 'pointer');
    };

    const onPointerMove = (event: PointerEvent) => {
      if (stream !== 'pointer' || !start || start.id !== event.pointerId) return;
      move(event.clientX, event.clientY, event.pointerId, event);
      if (tracking) {
        try { element.setPointerCapture(event.pointerId); } catch { /* optional */ }
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (stream !== 'pointer') return;
      end(event.pointerId);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (stream !== 'pointer' || !start || start.id !== event.pointerId) return;
      void finish(false);
    };

    // Capture so a pull that starts on the inner scroller still reaches us before
    // the browser commits to rubber-band scrolling.
    const touchOpts: AddEventListenerOptions = { capture: true };
    const moveOpts: AddEventListenerOptions = { capture: true, passive: false };
    for (const root of touchRoots) {
      root.addEventListener('touchstart', onTouchStart, touchOpts);
      root.addEventListener('touchmove', onTouchMove, moveOpts);
      root.addEventListener('touchend', onTouchEnd, touchOpts);
      root.addEventListener('touchcancel', onTouchCancel, touchOpts);
    }
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove, { passive: false });
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerCancel);
    detach.current = () => {
      for (const root of touchRoots) {
        root.removeEventListener('touchstart', onTouchStart, touchOpts);
        root.removeEventListener('touchmove', onTouchMove, moveOpts);
        root.removeEventListener('touchend', onTouchEnd, touchOpts);
        root.removeEventListener('touchcancel', onTouchCancel, touchOpts);
        delete root.dataset['pulling'];
      }
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
      element.style.removeProperty('--pull-distance');
      delete element.dataset['pulling'];
    };
  }, []);

  const ref = useCallback((element: HTMLElement | null) => {
    surfaceRef.current = element;
    bind();
  }, [bind]);

  const scrollRef = useCallback((element: HTMLElement | null) => {
    scrollHostRef.current = element;
    // Re-bind so touch listeners attach to the scroller once it mounts.
    if (surfaceRef.current) bind();
  }, [bind]);

  return {
    ref,
    scrollRef,
    distance,
    refreshing,
    armed: distance >= THRESHOLD && !refreshing,
  };
}
