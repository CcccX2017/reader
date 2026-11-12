import { describe, expect, it } from 'vitest';
import { DISPLAY_NAME_MAX_UNITS, clampDisplayName, displayNameUnits } from '../src/shared/display-name.ts';

describe('display name width', () => {
  it('counts a Chinese character as two and a letter as one', () => {
    expect(displayNameUnits('林')).toBe(2);
    expect(displayNameUnits('lin')).toBe(3);
    expect(displayNameUnits('林lin')).toBe(5);
    expect(DISPLAY_NAME_MAX_UNITS).toBe(10);
  });

  it('keeps a full name and drops the character that would pass the limit', () => {
    expect(clampDisplayName('字'.repeat(5))).toBe('字'.repeat(5));
    expect(clampDisplayName('字'.repeat(6))).toBe('字'.repeat(5));
    expect(clampDisplayName(`n${'字'.repeat(5)}`)).toBe(`n${'字'.repeat(4)}`);
    expect(clampDisplayName('n'.repeat(11))).toBe('n'.repeat(10));
  });
});
