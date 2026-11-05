import { afterEach, describe, expect, it, vi } from 'vitest';
import wranglerConfig from '../wrangler.jsonc?raw';
import worker, { type Env } from '../src/index.js';

const env: Env = {
  LAMBDA_URL: 'https://abc.lambda-url.ap-southeast-1.on.aws/',
  ORIGIN_SECRET: 'bound-secret',
};

let upstream: Request | undefined;
function stubUpstream(res: () => Response = () => new Response('ok')) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      upstream = input instanceof Request ? input : new Request(input, init);
      return res();
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  upstream = undefined;
});

const call = (req: Request) => worker.fetch(req, env);

describe('edge proxy', () => {
  it('forwards method, path, query, body and Cookie to LAMBDA_URL', async () => {
    stubUpstream();
    await call(
      new Request('https://app.example/api/v1/sync/push?x=1&y=2', {
        method: 'POST',
        headers: { cookie: 'a=b', 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
      }),
    );
    const u = new URL(upstream!.url);
    expect(u.origin).toBe('https://abc.lambda-url.ap-southeast-1.on.aws');
    expect(u.pathname + u.search).toBe('/api/v1/sync/push?x=1&y=2');
    expect(upstream!.method).toBe('POST');
    expect(upstream!.headers.get('cookie')).toBe('a=b');
    expect(await upstream!.json()).toEqual({ hello: 'world' });
  });

  it('streams the request body', async () => {
    stubUpstream();
    await call(new Request('https://app.example/api/v1/x', { method: 'POST', body: 'data' }));
    expect(upstream!.body).toBeInstanceOf(ReadableStream);
  });

  it('strips an incoming x-origin-secret and sets the bound one', async () => {
    stubUpstream();
    await call(
      new Request('https://app.example/api/x', { headers: { 'x-origin-secret': 'attacker' } }),
    );
    expect(upstream!.headers.get('x-origin-secret')).toBe('bound-secret');
  });

  it('takes x-forwarded-for from CF-Connecting-IP, ignoring a spoofed one', async () => {
    stubUpstream();
    await call(
      new Request('https://app.example/api/x', {
        headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' },
      }),
    );
    expect(upstream!.headers.get('x-forwarded-for')).toBe('203.0.113.9');
  });

  it('returns Set-Cookie unchanged and the response is not cached', async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'cache-control': 'public, max-age=600',
    });
    headers.append('set-cookie', 'a=1; Path=/; HttpOnly; Secure');
    headers.append('set-cookie', 'b=2; Path=/; HttpOnly');
    stubUpstream(() => new Response('{}', { headers }));
    const res = await call(new Request('https://app.example/api/x'));
    expect(res.headers.getSetCookie()).toEqual([
      'a=1; Path=/; HttpOnly; Secure',
      'b=2; Path=/; HttpOnly',
    ]);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('passes upstream status codes through', async () => {
    stubUpstream(() => new Response(null, { status: 429, headers: { 'retry-after': '30' } }));
    const res = await call(new Request('https://app.example/api/v1/sync/pull'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
  });

  it('does not follow redirects (media 302 goes to the client)', async () => {
    stubUpstream(
      () => new Response(null, { status: 302, headers: { location: 'https://r2.example/x' } }),
    );
    const res = await call(new Request('https://app.example/api/v1/media/1'));
    expect(res.status).toBe(302);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]).toBeDefined();
  });

  it('non-/api paths never reach the script: assets run_worker_first is /api/* only', () => {
    expect(wranglerConfig).toContain('"run_worker_first": ["/api/*"]');
  });

  it('answers 404 for non-/api paths if it is ever invoked for them', async () => {
    stubUpstream();
    const res = await call(new Request('https://app.example/index.html'));
    expect(res.status).toBe(404);
    expect(upstream).toBeUndefined();
  });
});
