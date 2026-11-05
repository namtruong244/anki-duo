import { describe, expect, it } from 'vitest';
import headersFile from '../../web/public/_headers?raw';

/** Parses the Cloudflare `_headers` format: unindented path, indented `Name: value` lines. */
function parse(text: string) {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = rules.get(raw.trim()) ?? new Map();
      rules.set(raw.trim(), current);
    } else if (current) {
      const i = raw.indexOf(':');
      current.set(raw.slice(0, i).trim().toLowerCase(), raw.slice(i + 1).trim());
    }
  }
  return rules;
}

const rules = parse(headersFile);

describe('apps/web/public/_headers', () => {
  it('hashed assets are cached for a year, immutable', () => {
    expect(rules.get('/assets/*')?.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('index.html and sw.js are no-cache', () => {
    expect(rules.get('/index.html')?.get('cache-control')).toBe('no-cache');
    expect(rules.get('/sw.js')?.get('cache-control')).toBe('no-cache');
  });

  it('has a strict CSP', () => {
    const csp = rules.get('/*')?.get('content-security-policy') ?? '';
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });
});
