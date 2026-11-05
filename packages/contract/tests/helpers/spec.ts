import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

type Json = Record<string, unknown>;

export const specPath = new URL(
  '../../../../specs/001-fsrs-gamified-learning/contracts/openapi.yaml',
  import.meta.url,
);

export const loadSpec = (): Json => parse(readFileSync(specPath, 'utf8')) as Json;

/** Resolves local `$ref`s so documents written differently can be compared by shape. */
export function deref(node: unknown, root: Json, seen = new Set<string>()): unknown {
  if (Array.isArray(node)) return node.map((n) => deref(n, root, seen));
  if (node && typeof node === 'object') {
    const obj = node as Json;
    if (typeof obj.$ref === 'string') {
      const ref = obj.$ref;
      if (seen.has(ref)) return { $recursive: ref };
      const target = ref
        .replace(/^#\//, '')
        .split('/')
        .reduce<unknown>((acc, k) => (acc as Json)[k], root);
      return deref(target, root, new Set([...seen, ref]));
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, deref(v, root, seen)]));
  }
  return node;
}

/**
 * Reduces a schema to the facts a client depends on: type, required, property names, enums,
 * bounds and formats. Wording (descriptions, examples) and equivalent spellings are ignored.
 */
export function shape(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(shape);
  if (!schema || typeof schema !== 'object') return schema;
  const s = schema as Json;
  const out: Json = {};
  for (const key of [
    'type',
    'enum',
    'const',
    'format',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'maxItems',
    'minProperties',
    'pattern',
  ]) {
    if (s[key] !== undefined) out[key] = s[key];
  }
  // A one-value enum and `const` mean the same thing.
  if (Array.isArray(out.enum) && out.enum.length === 1) {
    out.const = out.enum[0];
    delete out.enum;
  }
  // `const` already fixes the type, so documents may or may not repeat it.
  if (out.const !== undefined) delete out.type;
  if (Array.isArray(out.type)) out.type = [...(out.type as string[])].sort();
  if (Array.isArray(s.required)) out.required = [...(s.required as string[])].sort();
  if (s.properties) {
    out.properties = Object.fromEntries(
      Object.entries(s.properties as Json)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shape(v)]),
    );
  }
  if (s.items) out.items = shape(s.items);
  for (const key of ['oneOf', 'anyOf']) if (s[key]) out.oneOf = (s[key] as unknown[]).map(shape);
  return out;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** One comparable record per operation: parameters, request body, response codes + bodies. */
export function operations(doc: Json): Map<string, unknown> {
  const resolved = deref(doc, doc) as Json;
  const out = new Map<string, unknown>();
  for (const [path, item] of Object.entries((resolved.paths ?? {}) as Json)) {
    const shared = ((item as Json).parameters ?? []) as Json[];
    for (const method of METHODS) {
      const op = (item as Json)[method] as Json | undefined;
      if (!op) continue;
      const params = [...shared, ...((op.parameters ?? []) as Json[])].map((p) => ({
        name: p.name,
        in: p.in,
        required: p.required ?? false,
        schema: shape(p.schema),
      }));
      params.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const body = ((op.requestBody as Json | undefined)?.content as Json | undefined)?.[
        'application/json'
      ];
      const responses = Object.fromEntries(
        Object.entries((op.responses ?? {}) as Json)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, r]) => {
            const content = (r as Json).content as Json | undefined;
            const mime = content ? Object.keys(content).sort() : [];
            const json = (content?.['application/json'] as Json | undefined)?.schema;
            return [code, { mime, schema: json ? shape(json) : undefined }];
          }),
      );
      out.set(`${method.toUpperCase()} ${path}`, {
        params,
        body: body ? shape((body as Json).schema) : undefined,
        responses,
      });
    }
  }
  return out;
}
