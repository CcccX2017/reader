/**
 * Same rule as the server (`server/src/lib/display-name.ts`).
 * A CJK character takes two columns, so five of them fill the home greeting.
 */
export const DISPLAY_NAME_MAX_UNITS = 10;

export function displayNameUnits(value: string): number {
  let units = 0;
  for (const char of value) units += wideCharacter(char) ? 2 : 1;
  return units;
}

/** Drops whole characters from the end until the name fits. */
export function clampDisplayName(value: string): string {
  let units = 0;
  let kept = '';
  for (const char of value) {
    const width = wideCharacter(char) ? 2 : 1;
    if (units + width > DISPLAY_NAME_MAX_UNITS) break;
    units += width;
    kept += char;
  }
  return kept;
}

function wideCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}
