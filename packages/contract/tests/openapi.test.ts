import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/openapi.js';
import { loadSpec, operations } from './helpers/spec.js';

// The generated document and the hand-reviewed contract file must agree on everything a client
// relies on: operations, parameters, request/response shapes and error codes (research R17).
const spec = operations(loadSpec());
const generated = operations(buildOpenApiDocument() as unknown as Record<string, unknown>);

describe('generated OpenAPI matches contracts/openapi.yaml', () => {
  for (const [key, op] of generated) {
    it(key, () => {
      expect(spec.has(key), `${key} is not in contracts/openapi.yaml`).toBe(true);
      expect(op).toEqual(spec.get(key));
    });
  }

  it('declares the same security schemes', () => {
    const doc = buildOpenApiDocument() as unknown as {
      components: { securitySchemes: Record<string, unknown> };
    };
    const s = (loadSpec() as { components: { securitySchemes: Record<string, unknown> } })
      .components.securitySchemes;
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(Object.keys(s).sort());
  });

  it('registers every path and operation of contracts/openapi.yaml', () => {
    expect([...generated.keys()].sort()).toEqual([...spec.keys()].sort());
  });
});
