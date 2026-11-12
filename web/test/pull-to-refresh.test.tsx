// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { isPullPointer, usePullToRefresh } from '../src/shared/ui/use-pull-to-refresh.ts';
import { PullRefreshIndicator } from '../src/ui/pull-refresh.tsx';

/** DevTools phone mouse → pointer (not a real finger; those go through TouchEvent). */
function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new window.PointerEvent(type, {
    bubbles: true, composed: true, cancelable: true, pointerType: 'mouse', isPrimary: true, pointerId: 1, ...init,
  });
}

let root: Root | null = null;
let previousTouchPoints: PropertyDescriptor | undefined;
beforeEach(() => {
  previousTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  if (previousTouchPoints) Object.defineProperty(navigator, 'maxTouchPoints', previousTouchPoints);
  else Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
});

function mount(onRefresh: () => Promise<void>) {
  let latest = { distance: 0, refreshing: false, armed: false };
  function Page() {
    const pull = usePullToRefresh(onRefresh);
    latest = { distance: pull.distance, refreshing: pull.refreshing, armed: pull.armed };
    return <div ref={pull.ref} id="scroller" style={{ height: 200, overflow: 'auto' }}>
      <PullRefreshIndicator distance={pull.distance} refreshing={pull.refreshing} armed={pull.armed} />
      <p id="text">text</p>
    </div>;
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Page />));
  const scroller = document.getElementById('scroller')!;
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => 0, set: () => undefined });
  return {
    latest: () => latest,
    scroller,
    pull(dy: number, end: 'up' | 'cancel' = 'up') {
      scroller.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 40 }));
      scroller.dispatchEvent(pointer('pointermove', { clientX: 100, clientY: 40 + dy }));
      scroller.dispatchEvent(pointer(end === 'up' ? 'pointerup' : 'pointercancel', { clientX: 100, clientY: 40 + dy }));
    },
  };
}

describe('usePullToRefresh', () => {
  it('arms after a deep enough downward pull and refreshes on release', async () => {
    const onRefresh = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    const { latest, pull } = mount(onRefresh);
    act(() => pull(40));
    expect(latest().distance).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => {
      const scroller = document.getElementById('scroller')!;
      scroller.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 40 }));
      scroller.dispatchEvent(pointer('pointermove', { clientX: 100, clientY: 200 }));
    });
    expect(latest().distance).toBeGreaterThan(0);
    expect(latest().armed).toBe(true);

    await act(async () => {
      document.getElementById('scroller')!.dispatchEvent(pointer('pointerup', { clientX: 100, clientY: 200 }));
      await new Promise(resolve => setTimeout(resolve, 40));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(latest().refreshing).toBe(false);
    expect(latest().distance).toBe(0);
  });

  it('ignores a sideways swipe and a cancel', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const { latest, pull } = mount(onRefresh);
    act(() => {
      const scroller = document.getElementById('scroller')!;
      scroller.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 40 }));
      scroller.dispatchEvent(pointer('pointermove', { clientX: 220, clientY: 60 }));
      scroller.dispatchEvent(pointer('pointerup', { clientX: 220, clientY: 60 }));
    });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(latest().distance).toBe(0);

    act(() => pull(180, 'cancel'));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(latest().distance).toBe(0);
  });

  it('shows the sync label while the indicator is open', () => {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<PullRefreshIndicator distance={72} refreshing={false} armed />));
    expect(host.textContent).toContain('松开同步书库');
    act(() => root!.render(<PullRefreshIndicator distance={64} refreshing armed={false} />));
    expect(host.textContent).toContain('正在同步书库');
  });

  it('offsets a scroller sitting at 0 so WebKit will let the page claim the pull', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const { scroller } = mount(onRefresh);
    let top = 0;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; } });
    const touch = (type: string, y: number) => {
      const t = { identifier: 1, clientX: 100, clientY: y, target: scroller, screenX: 100, screenY: y, pageX: 100, pageY: y, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 };
      scroller.dispatchEvent(new window.TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: type === 'touchend' ? [] : [t as unknown as Touch],
        targetTouches: type === 'touchend' ? [] : [t as unknown as Touch],
        changedTouches: [t as unknown as Touch],
      }));
    };
    act(() => touch('touchstart', 40));
    expect(top).toBe(1);
    await act(async () => {
      touch('touchmove', 200);
      touch('touchend', 200);
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(top).toBe(0);
  });

  it('survives the inline scroll ref React calls again on each pull frame', async () => {
    const onRefresh = vi.fn(async () => undefined);
    function Page() {
      const pull = usePullToRefresh(onRefresh);
      return <div ref={pull.ref} id="surface">
        <div ref={element => { pull.scrollRef(element); }} id="pane" style={{ height: 120, overflow: 'auto' }}><p>books</p></div>
      </div>;
    }
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root!.render(<Page />); await Promise.resolve(); });
    const pane = document.getElementById('pane')!;
    let top = 0;
    Object.defineProperty(pane, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; } });
    const touch = (type: string, y: number) => {
      const t = { identifier: 1, clientX: 80, clientY: y, target: pane, screenX: 80, screenY: y, pageX: 80, pageY: y, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 };
      pane.dispatchEvent(new window.TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: type === 'touchend' ? [] : [t as unknown as Touch],
        targetTouches: type === 'touchend' ? [] : [t as unknown as Touch],
        changedTouches: [t as unknown as Touch],
      }));
    };
    await act(async () => {
      touch('touchstart', 40);
      touch('touchmove', 90);
      touch('touchmove', 220);
      touch('touchend', 220);
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes from a real touch stream (phones cannot rely on pointer preventDefault)', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const { latest, scroller } = mount(onRefresh);
    const touch = (type: string, y: number) => {
      const target = scroller;
      const t = { identifier: 1, clientX: 100, clientY: y, target, screenX: 100, screenY: y, pageX: 100, pageY: y, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 };
      target.dispatchEvent(new window.TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: type === 'touchend' || type === 'touchcancel' ? [] : [t as unknown as Touch],
        targetTouches: type === 'touchend' || type === 'touchcancel' ? [] : [t as unknown as Touch],
        changedTouches: [t as unknown as Touch],
      }));
    };
    await act(async () => {
      touch('touchstart', 40);
      touch('touchmove', 200);
      touch('touchend', 200);
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(latest().distance).toBe(0);
  });

  it('lets a pull on the page surface refresh while an inner pane reports scrollTop', async () => {
    const onRefresh = vi.fn(async () => undefined);
    let latest = { distance: 0, refreshing: false, armed: false };
    function Page() {
      const pull = usePullToRefresh(onRefresh);
      latest = { distance: pull.distance, refreshing: pull.refreshing, armed: pull.armed };
      return <div ref={pull.ref} id="surface">
        <header id="chrome">greeting</header>
        <div ref={pull.scrollRef} id="pane" style={{ height: 120, overflow: 'auto' }}><p>books</p></div>
      </div>;
    }
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<Page />));
    const pane = document.getElementById('pane')!;
    Object.defineProperty(pane, 'scrollTop', { configurable: true, get: () => 0, set: () => undefined });
    const surface = document.getElementById('surface')!;
    await act(async () => {
      document.getElementById('chrome')!.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 20 }));
      surface.dispatchEvent(pointer('pointermove', { clientX: 100, clientY: 200 }));
      surface.dispatchEvent(pointer('pointerup', { clientX: 100, clientY: 200 }));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(latest.distance).toBe(0);
  });

  it('accepts a DevTools mouse on a coarse/touch viewport, not a plain desktop mouse', async () => {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
    expect(isPullPointer({ pointerType: 'touch', isPrimary: true })).toBe(true);
    expect(isPullPointer({ pointerType: 'mouse', isPrimary: true })).toBe(false);

    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    expect(isPullPointer({ pointerType: 'mouse', isPrimary: true })).toBe(true);

    const onRefresh = vi.fn(async () => undefined);
    const { latest, scroller } = mount(onRefresh);
    await act(async () => {
      scroller.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 40 }));
      scroller.dispatchEvent(pointer('pointermove', { clientX: 100, clientY: 200 }));
      scroller.dispatchEvent(pointer('pointerup', { clientX: 100, clientY: 200 }));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(latest().distance).toBe(0);
  });
});
