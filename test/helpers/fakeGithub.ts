/**
 * Replaces global fetch with a tiny in-memory GitHub REST double. Routes are
 * matched on `${method} ${pathname+search}`; unmatched requests return 404.
 * Every request is recorded so tests can assert on what was sent.
 */
export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export type Route = (req: RecordedRequest) => { status: number; body?: unknown } | undefined;

export function installFakeGithub(routes: Record<string, Route | { status: number; body?: unknown }>) {
  const original = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const req: RecordedRequest = {
      method,
      path: url.pathname + url.search,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    const route = routes[`${method} ${req.path}`];
    const out = typeof route === 'function' ? route(req) : route;
    const status = out?.status ?? 404;
    const payload = out?.body === undefined ? '' : JSON.stringify(out.body);
    return new Response(status === 204 ? null : payload, { status });
  }) as typeof fetch;
  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
