/**
 * The middle of the screen turns with OpenPageFlip's edge furl.
 *
 * A straight pull keeps the crease parallel to the spine, which is that
 * library's whole-edge curl. The corners stay on the other book. This one is
 * only mounted for the middle band, and it does not take taps: the overlay
 * ignores pointers, and these events are sent to the book by the reader.
 *
 * @openpageflip/core is MIT.
 */
import { createBook, type Book } from '@openpageflip/core';
import { whenFaceSettled } from './page-curl.tsx';

export type EdgeCurl = {
  /** Resolves once the leaf is on screen and the finger can move it. */
  ready(): Promise<void>;
  /**
   * Puts the real destination page into the slot the curl was opened with.
   * The slot element stays, so a fold already in progress is not dropped.
   */
  adopt(face: HTMLElement): void;
  /** `travel` is how far the finger has pulled in from the turning edge. */
  drive(travel: number): void;
  /** Plays the furl out to the end, or back to flat. */
  finish(commit: boolean): Promise<void>;
  destroy(): void;
};

/**
 * Two captured faces, in a book that only this turn uses.
 *
 * `before` is the page the reader was on. `after` is the one the turn lands
 * on. Forward pulls the outer edge straight in. Back pulls the spine edge
 * straight out, which is how this library uncurls the previous page. The
 * pointer stays at one height, so the crease stays vertical for the whole
 * page instead of peeling a corner.
 */
export function mountEdgeCurl(
  overlay: HTMLElement,
  before: HTMLElement,
  after: HTMLElement,
  direction: 'next' | 'previous',
): EdgeCurl {
  const host = document.createElement('div');
  host.className = 'reader-edge-book';
  const stage = document.createElement('div');
  stage.className = 'reader-edge-stage';
  // The overlay is still hidden while this book is built, and a hidden box can
  // report no size. A 1px page then finishes as soon as the finger lets go.
  // The stage behind it is on screen and already has the page's real size.
  const frame = overlay.clientWidth >= 2 ? overlay : (overlay.parentElement ?? overlay);
  const width = Math.max(1, frame.clientWidth);
  const height = Math.max(1, frame.clientHeight);
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  const leaf = (face: HTMLElement) => {
    const page = document.createElement('div');
    page.className = 'reader-edge-page';
    page.append(face);
    return page;
  };
  const pages = direction === 'next' ? [leaf(before), leaf(after)] : [leaf(after), leaf(before)];
  stage.append(...pages);
  host.append(stage);
  overlay.querySelector('.reader-curl-book')?.append(host);

  const book = createBook(stage, {
    width,
    height,
    size: 'fixed',
    layout: 'single',
    autoSize: false,
    startPage: direction === 'next' ? 0 : 1,
    flipDuration: 400,
    shadows: true,
    shadowOpacity: 0.5,
    click: 'off',
    drag: true,
    swipe: false,
    hover: false,
    ignoreDragOn: false,
  });
  const observer = new MutationObserver(() => {
    stage.querySelectorAll<HTMLElement>('.book-host').forEach((face) => {
      void whenFaceSettled(face);
    });
  });
  observer.observe(stage, { childList: true, subtree: true });

  let dead = false;
  let primed = false;
  let open = false;
  let down = false;
  let travel = 0;
  let destination = after;
  let bounds = stage.getBoundingClientRect();
  const y = height / 2;
  const point = (distance: number) => (direction === 'next' ? width - 4 - distance : 4 + distance);
  // The pointer stays with the finger. Doubling it runs the corner to the end
  // of the sheet while the finger is still near the edge, and the full-height
  // curl collapses into a fast flip.

  const hold = () => {
    if (down || dead || !primed) return;
    const painted = [...stage.querySelectorAll('.opf-page')].some(
      (node) => node instanceof HTMLElement && node.offsetHeight > 0,
    );
    if (!painted) return;
    bounds = stage.getBoundingClientRect();
    if (bounds.width < 2) return;
    send('pointerdown', point(0));
    down = true;
  };

  const send = (type: 'pointerdown' | 'pointermove' | 'pointerup', x: number) => {
    if (!stage.isConnected) return;
    stage.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + x,
        clientY: bounds.top + y,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
      }),
    );
  };

  const glide = (from: number, to: number, duration: number) =>
    new Promise<void>((resolve) => {
      const started = performance.now();
      const step = (now: number) => {
        if (dead || !stage.isConnected) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - started) / duration);
        travel = from + (to - from) * t;
        send('pointermove', point(travel));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

  return {
    async ready() {
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        book.on('init', done);
        window.setTimeout(done, 400);
      });
      if (dead) return;
      await new Promise<void>((resolve) => {
        let tries = 0;
        const check = () => {
          const shown = [...stage.querySelectorAll('.opf-page')].some(
            (node) => node instanceof HTMLElement && node.offsetHeight > 0,
          );
          if (dead || shown || tries > 20) resolve();
          else {
            tries += 1;
            requestAnimationFrame(check);
          }
        };
        requestAnimationFrame(check);
      });
      if (dead) return;
      primed = true;
    },
    adopt(face) {
      if (dead) return;
      if (face !== destination) {
        destination.replaceWith(face);
        destination = face;
        void whenFaceSettled(face);
      }
      // The finger may already have moved while this slot was still the blank
      // page. Draw that position now, under the cover, so lifting the cover
      // shows the cylinder instead of a flat sheet.
      open = true;
      if (!primed || travel <= 0) return;
      hold();
      send('pointermove', point(travel));
    },
    drive(next) {
      if (dead) return;
      travel = Math.max(0, Math.min(width, next));
      if (!primed || !open) return;
      hold();
      send('pointermove', point(travel));
    },
    async finish(commit) {
      if (dead || !primed) return;
      hold();
      if (!down) return;
      // One width of pointer only brings a forward curl to the spine. The sheet
      // still has the second half to go, and an ease-out dies on the spine, so
      // the turn stalls and a second animation has to finish it. Run the pointer
      // in one straight line for the whole of that distance. A back turn already
      // moves the corner twice as far, so its line is one width, not two.
      // A committed turn takes 0.4s, the same as a corner peel. Scaling the tail
      // by the distance left made a short remainder finish in a flash.
      const span = direction === 'next' ? width * 2 : width;
      const end = commit ? Math.max(travel, span) : 0;
      const duration = commit ? 400 : Math.max(200, 280 * (Math.abs(end - travel) / span));
      await glide(travel, end, duration);
      if (dead) return;
      send('pointerup', point(end));
      down = false;
      await landed(book, commit);
    },
    destroy() {
      dead = true;
      observer.disconnect();
      book.destroy();
      host.remove();
    },
  };
}

/** The library reports a landing with `flip`, and a curl that falls back with `read`. */
function landed(book: Book, commit: boolean): Promise<void> {
  return new Promise((resolve) => {
    let timer = 0;
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    timer = window.setTimeout(done, commit ? 1600 : 900);
    if (commit) book.on('flip', done);
    else
      book.on('changeState', (event) => {
        if (event.state === 'read') done();
      });
  });
}
