import { describe, expect, it } from 'vitest';
import ICU from 'i18next-icu';
import en from '../src/i18n/messages/en.json';
import vi from '../src/i18n/messages/vi.json';
import { detectLocale } from '../src/i18n';

const flatten = (o: Record<string, unknown>, prefix = ''): Record<string, string> =>
  Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') acc[key] = v;
    else Object.assign(acc, flatten(v as Record<string, unknown>, key));
    return acc;
  }, {});

const E = flatten(en);
const V = flatten(vi);

describe('i18n catalogs (SC-009)', () => {
  it('have identical key sets', () => {
    expect(Object.keys(V).sort()).toEqual(Object.keys(E).sort());
  });

  it('contain no empty messages', () => {
    for (const [k, v] of [...Object.entries(E), ...Object.entries(V)]) expect(v, k).not.toBe('');
  });

  it('are valid ICU messages', () => {
    const icu = new ICU() as unknown as {
      parse(m: string, v: object, l: string, ns: string, k: string, i: object): unknown;
    };
    for (const [lng, cat] of [
      ['en', E],
      ['vi', V],
    ] as const) {
      for (const [key, msg] of Object.entries(cat)) {
        expect(
          () => icu.parse(msg, { email: 'a@b.c', count: 1 }, lng, 'translation', key, {}),
          `${lng}:${key}`,
        ).not.toThrow();
      }
    }
  });

  it('use the same placeholders in both languages', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(E)) expect(vars(V[k]!), k).toEqual(vars(E[k]!));
  });
});

describe('detectLocale', () => {
  it('maps vi* to vi and everything else to en', () => {
    expect(detectLocale(['vi-VN', 'en'])).toBe('vi');
    expect(detectLocale(['en-US'])).toBe('en');
    expect(detectLocale(['fr'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
});
