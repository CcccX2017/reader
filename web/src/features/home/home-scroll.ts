/** Which pane should take the next vertical movement on the home page. */
export function homeScrollTarget(input: {
  /** Positive moves content upward (further down the page). */
  deltaY: number;
  /** 「我的书架」is already against the top of the scrolling area. */
  sectionPinned: boolean;
  shelfTop: number;
}): 'body' | 'shelf' {
  if (input.deltaY > 0) return input.sectionPinned ? 'shelf' : 'body';
  if (input.deltaY < 0) return input.shelfTop > 1 ? 'shelf' : 'body';
  return 'shelf';
}

export function wheelPixels(deltaY: number, deltaMode: number, pageSize: number): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * pageSize;
  return deltaY;
}
