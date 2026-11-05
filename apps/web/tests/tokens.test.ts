import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, '../src/styles/tokens.css'), 'utf8');
const token = (n: string) => css.match(new RegExp(`--color-${n}:\\s*(#[0-9a-f]{6})`, 'i'))![1]!;

const lum = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('design tokens meet WCAG 2.2 AA contrast', () => {
  const pairs: [string, string][] = [
    ['text', 'bg'],
    ['text', 'surface'],
    ['text-muted', 'bg'],
    ['text-muted', 'surface'],
    ['on-primary', 'primary'],
    ['on-secondary', 'secondary'],
    ['on-danger', 'danger'],
    ['on-neutral', 'neutral'],
  ];
  for (const [fg, bg] of pairs) {
    it(`${fg} on ${bg} >= 4.5:1`, () =>
      expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5));
  }
  it('focus ring vs background >= 3:1', () =>
    expect(contrast(token('focus'), token('bg'))).toBeGreaterThanOrEqual(3));
});
