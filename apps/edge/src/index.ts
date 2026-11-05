export interface Env {
  LAMBDA_URL: string;
  ORIGIN_SECRET: string;
}

/**
 * Static assets are served by the platform (wrangler `assets`); this script runs only for
 * `/api/*` and forwards the request to the Lambda Function URL, so the browser sees one origin.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    const target = new URL(url.pathname + url.search, env.LAMBDA_URL);
    const headers = new Headers(request.headers);
    // Only this Worker may vouch for the origin: replace whatever the client sent.
    headers.set('x-origin-secret', env.ORIGIN_SECRET);
    headers.delete('x-forwarded-for');
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) headers.set('x-forwarded-for', ip);
    headers.delete('host');

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method,
      headers,
      body: hasBody ? request.body : null,
      redirect: 'manual',
    };
    if (hasBody) init.duplex = 'half';
    const upstream = await fetch(new Request(target, init));

    // Rebuild the response so Set-Cookie (multiple values) passes through and nothing is cached.
    const out = new Response(upstream.body, upstream);
    out.headers.set('cache-control', 'no-store');
    return out;
  },
};
