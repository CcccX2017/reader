/**
 * A curl drawn over one page turn.
 *
 * The novel stays in the reader's own layout. This only covers the turn with
 * the page that was left and the page that was landed on, then goes away.
 * It does not take clicks: 点击区域 stays the grid on the stage underneath.
 */
import { forwardRef, useEffect, useLayoutEffect, useRef, type JSX } from 'react';
import HTMLFlipBook, {
  type BookSnapshot,
  type FlipBookHandle,
  type PageFlip,
  type WidgetEvent,
} from '@gullabs/react-flipbook';
import type { BookShadowHost } from './shadow.ts';

interface FaceScroll {
  left: number;
  top: number;
}

/**
 * A standalone copy of one screen of the open chapter.
 *
 * The chapter's styles stay in a shadow root, the same place the real page keeps
 * them. A `<style>` in the light DOM would apply to the whole app and restyle the
 * novel with the book's own rules and the reader's rules at once — that is the
 * broken formatting. The shadow markup is also held in a `<template>` (inert, so
 * it does not paint twice). StPageFlip clones a page with `cloneNode` while it
 * turns, and that copy does not bring the shadow root; the template does come
 * along, and the copy grows its own shadow from it.
 */
export function captureReadingFace(host: BookShadowHost, place?: { left: number; top: number }): HTMLElement {
  const frame = document.createElement('div');
  frame.className = host.className;
  frame.style.cssText = host.style.cssText;
  frame.style.overflow = 'hidden';
  // The live page is hidden while the curl plays, so it does not flash under the
  // sheet. The copy is taken after that hide, and it must still paint: otherwise
  // the page underneath the curl is blank paper until the animation ends.
  frame.style.visibility = 'visible';
  for (const name of host.getAttributeNames()) {
    if (name === 'class' || name === 'style') continue;
    const value = host.getAttribute(name);
    if (value !== null) frame.setAttribute(name, value);
  }
  const template = document.createElement('template');
  template.className = 'reader-flip-source';
  for (const node of host.shadow.childNodes) template.content.append(node.cloneNode(true));
  frame.append(template);
  const scroll: FaceScroll = {
    left: place?.left ?? host.flow.scrollLeft,
    top: place?.top ?? (host.scrollTop || host.flow.scrollTop),
  };
  frame.dataset['scroll'] = JSON.stringify(scroll);
  settleReadingFace(frame);
  return frame;
}

/** Gives a copied page the chapter's shadow tree, if the flip cloned it away. */
function mountFace(frame: HTMLElement): void {
  if (frame.shadowRoot) return;
  const template = frame.querySelector('template.reader-flip-source');
  if (!(template instanceof HTMLTemplateElement)) return;
  frame.attachShadow({ mode: 'open' }).append(template.content.cloneNode(true));
}

function settleReadingFace(frame: HTMLElement): void {
  mountFace(frame);
  const raw = frame.dataset['scroll'];
  if (!raw) return;
  const scroll = JSON.parse(raw) as FaceScroll;
  let tries = 0;
  const apply = () => {
    tries += 1;
    const flow = frame.shadowRoot?.querySelector('.book-flow');
    let pending = false;
    // Paged mode scrolls the column. Scroll mode scrolls the frame. Either offset
    // is ignored until the copy has a size, so keep trying until it sticks.
    // A clone made mid-turn starts at zero even though it copied this dataset,
    // so the check is the live scroll, not a flag on the element.
    if (flow instanceof HTMLElement && scroll.left > 1) {
      if (flow.scrollLeft < scroll.left - 1) {
        flow.scrollLeft = scroll.left;
        if (flow.scrollLeft < scroll.left - 1) pending = true;
      }
    }
    if (scroll.top > 1 && frame.scrollTop < scroll.top - 1) {
      frame.scrollTop = scroll.top;
      if (frame.scrollTop < scroll.top - 1) pending = true;
    }
    if (pending && tries < 30) requestAnimationFrame(apply);
  };
  apply();
}

/** Resolves once a copied page has a size and is scrolled to the screen it copied. */
export function whenFaceSettled(frame: HTMLElement): Promise<void> {
  settleReadingFace(frame);
  return new Promise((resolve) => {
    let tries = 0;
    const check = () => {
      tries += 1;
      const raw = frame.dataset['scroll'];
      const scroll = raw ? (JSON.parse(raw) as FaceScroll) : { left: 0, top: 0 };
      const flow = frame.shadowRoot?.querySelector('.book-flow');
      const leftOk = !(flow instanceof HTMLElement) || scroll.left <= 1 || flow.scrollLeft >= scroll.left - 1;
      const topOk = scroll.top <= 1 || frame.scrollTop >= scroll.top - 1;
      if ((frame.clientHeight > 0 && leftOk && topOk) || tries > 20) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

const FlipPage = forwardRef<HTMLDivElement, { face: HTMLElement; hard: boolean }>(function FlipPage(
  { face, hard },
  ref,
) {
  const sheet = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = sheet.current;
    if (!node) return;
    node.replaceChildren(face);
    settleReadingFace(face);
    const again = requestAnimationFrame(() => settleReadingFace(face));
    return () => cancelAnimationFrame(again);
  }, [face]);
  return (
    <div className="reader-flip-page" ref={ref} data-density={hard ? 'hard' : 'soft'}>
      <div ref={sheet} className="reader-flip-sheet" />
    </div>
  );
});

export type CurlFold = 'top' | 'bottom' | 'line';

/**
 * How this finger lifts the page.
 *
 * Near the top the sheet peels from the top corner, near the bottom from the
 * bottom corner. Those two are this book. Near the vertical middle the reader
 * uses the other library, which furls the whole edge in one straight line.
 */
export function curlFold(y: number, height: number): CurlFold {
  if (!(height > 0)) return 'bottom';
  const t = y / height;
  if (t >= 0.3 && t <= 0.7) return 'line';
  return t < 0.5 ? 'top' : 'bottom';
}

export interface CurlBook {
  startUserTouch(point: { x: number; y: number }): void;
  userMove(point: { x: number; y: number }, isTouch?: boolean): void;
  userStop(point: { x: number; y: number }, isSwipe?: boolean): void;
  getCurrentPageIndex(): number;
  flipNext(corner?: 'top' | 'bottom'): void;
  flipPrev(corner?: 'top' | 'bottom'): void;
  on(event: 'flip' | 'changeState', handler: (event: { data?: number | string }) => void): void;
}

/**
 * The engine reports a landing as a snapshot. The reader still listens for the
 * page number, which is what the old book put on the event.
 */
function asCurlBook(flip: PageFlip): CurlBook {
  return {
    startUserTouch: (point) => flip.startUserTouch(point),
    userMove: (point, isTouch) => flip.userMove(point, isTouch ?? true),
    userStop: (point, isSwipe) => flip.userStop(point, isSwipe),
    getCurrentPageIndex: () => flip.getCurrentPageIndex(),
    flipNext: (corner) => {
      flip.flipNext(corner ?? 'bottom');
    },
    flipPrev: (corner) => {
      flip.flipPrev(corner ?? 'bottom');
    },
    on: (event, handler) => {
      if (event === 'flip') {
        flip.on('flip', (widget: WidgetEvent<BookSnapshot>) => handler({ data: widget.data.page }));
        return;
      }
      flip.on('changeState', (widget: WidgetEvent<{ state: string }>) => handler({ data: widget.data.state }));
    },
  };
}

export function PageCurl({
  width,
  height,
  before,
  after,
  direction,
  fold = 'bottom',
  hold,
  onReady,
  onDone,
}: {
  width: number;
  height: number;
  before: HTMLElement;
  after: HTMLElement;
  direction: 'next' | 'previous';
  /** Which corner lifts. The page itself stays a soft sheet. */
  fold?: 'top' | 'bottom';
  /** When set, the page waits for the finger instead of turning on its own. */
  hold?: boolean;
  onReady?(book: CurlBook): void;
  onDone(): void;
}): JSX.Element {
  const book = useRef<FlipBookHandle>(null);
  const done = useRef(false);
  const started = useRef(false);
  const finish = () => {
    if (!done.current) {
      done.current = true;
      onDone();
    }
  };
  const target = direction === 'next' ? 1 : 0;
  const leaves = direction === 'next' ? [before, after] : [after, before];
  const begin = () => {
    if (started.current) return;
    const flip = book.current?.pageFlip();
    // The book loads once empty and again with the two leaves. Only the second
    // load can turn, and a fixed-size book rejects min/max bounds.
    if (!flip || flip.getPageCount() < 2) return;
    started.current = true;
    const curl = asCurlBook(flip);
    if (hold) {
      onReady?.(curl);
      return;
    }
    if (direction === 'next') curl.flipNext(fold);
    else curl.flipPrev(fold);
  };
  useEffect(() => {
    const root = document.querySelector('.reader-flip-book');
    if (!root) return;
    const settleAll = () => {
      root.querySelectorAll<HTMLElement>('.book-host').forEach(settleReadingFace);
    };
    settleAll();
    const observer = new MutationObserver(settleAll);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [before, after]);
  return (
    <HTMLFlipBook
      ref={book}
      className="reader-flip-book"
      style={{ width, height }}
      initialPage={target === 1 ? 0 : 1}
      sizing="fixed"
      width={Math.max(1, width)}
      height={Math.max(1, height)}
      drawShadow
      flippingTime={400}
      usePortrait
      startZIndex={1}
      autoSize={false}
      maxShadowOpacity={0.5}
      hardCovers={false}
      allowTouchScroll={false}
      respectInteractiveContent={false}
      pointerInput={[]}
      swipeDistance={30}
      foldCornerOnHover={false}
      flipOnClick="never"
      pageBackground="var(--reader-paper)"
      controls="none"
      useKeyboard={false}
      liveRegion={false}
      onLoaded={begin}
      onPageChange={(snapshot) => {
        if (snapshot.page === target) finish();
      }}
    >
      {leaves.map((face, index) => (
        <FlipPage key={index} face={face} hard={false} />
      ))}
    </HTMLFlipBook>
  );
}
