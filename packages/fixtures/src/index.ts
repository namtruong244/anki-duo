import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const FIXTURE_NAMES = [
  'fsrs-vectors',
  'study-day',
  'xp',
  'queue',
  'path-assign',
  'path-status',
  'streak',
  'donut',
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

/** Loads a fixture file as JSON. Each fixture has a matching schema in `schema/`. */
export function loadFixture<T = unknown>(name: FixtureName): T {
  return JSON.parse(readFileSync(`${root}${name}.json`, 'utf8')) as T;
}

export function fixturePath(...parts: string[]): string {
  return [root, ...parts].join('');
}
