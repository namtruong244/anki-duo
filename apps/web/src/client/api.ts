import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './api-types';

export type ProblemCode = components['schemas']['Problem']['code'];

/** A typed error built from an `application/problem+json` body. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ProblemCode | 'network_error' | 'unknown',
    message: string,
    public readonly retryAfter?: number,
    public readonly errors?: { path?: string; message?: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function toApiError(res: Response): Promise<ApiError> {
  const retry = res.headers.get('retry-after');
  const retryAfter = retry ? Number(retry) : undefined;
  try {
    const body = (await res.clone().json()) as Partial<components['schemas']['Problem']>;
    return new ApiError(
      res.status,
      body.code ?? 'unknown',
      body.detail ?? body.title ?? res.statusText,
      retryAfter,
      body.errors,
    );
  } catch {
    return new ApiError(res.status, 'unknown', res.statusText, retryAfter);
  }
}

const throwOnProblem: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) throw await toApiError(response);
    return undefined;
  },
  onError({ error }) {
    throw new ApiError(
      0,
      'network_error',
      error instanceof Error ? error.message : 'network error',
    );
  },
};

/** Same-origin API client; the session cookie travels with every request. */
export function createApi(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? '/api/v1',
    credentials: 'same-origin',
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  client.use(throwOnProblem);
  return client;
}

export type Api = ReturnType<typeof createApi>;
export const api: Api = createApi();
