import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ajvModule from 'ajv/dist/2020.js';
import { FIXTURE_NAMES, fixturePath } from '../src/index.js';

const Ajv2020 = ((ajvModule as { default?: unknown }).default ?? ajvModule) as new (
  o: object,
) => import('ajv').default;
const ajv = new Ajv2020({ allErrors: true, strict: false });

describe('fixture files match their JSON Schema', () => {
  for (const name of FIXTURE_NAMES) {
    const file = fixturePath(`${name}.json`);
    // Fixtures arrive story by story; the completeness check lives in the contract tests (T157).
    it.skipIf(!existsSync(file))(name, () => {
      const schema = JSON.parse(readFileSync(fixturePath(`schema/${name}.schema.json`), 'utf8'));
      const validate = ajv.compile(schema);
      const ok = validate(JSON.parse(readFileSync(file, 'utf8')));
      expect(validate.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
    });
  }
});
