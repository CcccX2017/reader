// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { useHoldToSelect } from '../src/ui/cover-actions.tsx';

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  return new window.PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true,
    pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 40, clientY: 40, ...init,
  });
}

function mount(onSelect: () => void) {
  function Host() {
    const hold = useHoldToSelect(onSelect, true);
    return <button type="button" id="card" {...hold}>book</button>;
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Host />));
  return document.getElementById('card')!;
}

it('keeps the selection when the page reflows under a still-down finger', () => {
  vi.useFakeTimers();
  const onSelect = vi.fn();
  const card = mount(onSelect);
  act(() => { card.dispatchEvent(pointer('pointerdown')); });
  act(() => { vi.advanceTimersByTime(450); });
  expect(onSelect).toHaveBeenCalledTimes(1);

  // Selection chrome mounts and shifts the card; that must not unlock a later click.
  act(() => {
    window.dispatchEvent(pointer('pointermove', { clientX: 40, clientY: 80 }));
  });
  act(() => {
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  expect(onSelect).toHaveBeenCalledTimes(1);

  act(() => { window.dispatchEvent(pointer('pointerup')); });
  act(() => {
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  expect(onSelect).toHaveBeenCalledTimes(1);
});
