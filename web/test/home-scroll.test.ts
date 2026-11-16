import { describe, expect, it } from 'vitest';
import { homeScrollTarget, wheelPixels } from '../src/features/home/home-scroll.ts';

describe('home scroll handoff', () => {
  it('scrolls the page until the shelf title reaches the top, then the shelf', () => {
    expect(homeScrollTarget({ deltaY: 40, sectionPinned: false, shelfTop: 0 })).toBe('body');
    expect(homeScrollTarget({ deltaY: 40, sectionPinned: true, shelfTop: 0 })).toBe('shelf');
  });

  it('scrolls the shelf back to the top before the page', () => {
    expect(homeScrollTarget({ deltaY: -20, sectionPinned: true, shelfTop: 80 })).toBe('shelf');
    expect(homeScrollTarget({ deltaY: -20, sectionPinned: true, shelfTop: 0 })).toBe('body');
  });

  it('converts line and page wheel deltas into pixels', () => {
    expect(wheelPixels(2, 1, 400)).toBe(32);
    expect(wheelPixels(1, 2, 400)).toBe(400);
    expect(wheelPixels(12, 0, 400)).toBe(12);
  });
});
