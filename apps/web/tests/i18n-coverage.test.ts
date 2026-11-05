import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import en from '../src/i18n/messages/en.json';
import vi from '../src/i18n/messages/vi.json';
import { initI18n } from '../src/i18n';
import { ApiError } from '../src/client/api';
import { describeApiError } from '../src/lib/api-error';

const spec = parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../specs/001-fsrs-gamified-learning/contracts/openapi.yaml',
    ),
    'utf8',
  ),
) as { components: { schemas: { Problem: { properties: { code: { enum: string[] } } } } } };
const codes = spec.components.schemas.Problem.properties.code.enum;
const REASONS = [
  'empty_front',
  'front_too_long',
  'back_too_long',
  'too_many_tags',
  'tag_invalid',
  'malformed_row',
  'duplicate_skipped',
  'card_limit_reached',
  'import_bad_encoding',
  'single_column',
  'import_too_large',
];

beforeAll(() => void initI18n('en'));

describe('translation coverage (T150, SC-009)', () => {
  it.each([
    ['en', en],
    ['vi', vi],
  ] as const)('%s has a message for every API Problem.code', (_l, cat) => {
    const problems = (cat as unknown as { problem: Record<string, string> }).problem;
    for (const c of codes) expect(problems[c], c).toBeTruthy();
  });

  it.each([
    ['en', en],
    ['vi', vi],
  ] as const)('%s has every import reason', (_l, cat) => {
    const reasons = (cat as unknown as { import: { reasons: Record<string, string> } }).import
      .reasons;
    for (const r of REASONS) expect(reasons[r], r).toBeTruthy();
  });

  it('describeApiError gives a specific message for every code, in both languages', async () => {
    for (const lng of ['en', 'vi']) {
      await i18next.changeLanguage(lng);
      const generic = describeApiError(i18next.t, new ApiError(500, 'unknown', 'x'));
      for (const c of codes) {
        const msg = describeApiError(i18next.t, new ApiError(400, c as never, 'x'));
        expect(msg, `${lng}:${c}`).toBeTruthy();
        if (c !== 'validation_failed')
          expect(msg, `${lng}:${c} should not be the generic text`).not.toBe(generic);
      }
    }
    await i18next.changeLanguage('en');
  });
});
