interface Environment {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ENVIRONMENT?: string;
}

/** The zone routes must be exactly /market and /market/*. No origin fetch is
 * needed: all resources are served through the static asset binding. */
export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/market' && !url.pathname.startsWith('/market/')) {
      return new Response('Not found', { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    if (url.pathname === '/market') {
      url.pathname = '/market/';
      return Response.redirect(url.toString(), 308);
    }
    const path = url.pathname.slice('/market'.length);
    const shell = path === '/' || path === '/oauth/callback';
    // Explicit shell paths prevent missing JS/CSS from silently returning HTML.
    // Keep the browser URL (including OAuth query/state) intact: no redirect.
    url.pathname = shell ? '/index.html' : path;
    const response = await environment.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    // The deployment binding is trusted; the incoming Host header is not.
    // Missing/unknown environments default to the staging indexing restriction.
    if (environment.ENVIRONMENT !== 'production') headers.set('X-Robots-Tag', 'noindex, nofollow');
    if (shell) headers.set('Cache-Control', 'no-store');
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status, statusText: response.statusText, headers,
    });
  },
};
