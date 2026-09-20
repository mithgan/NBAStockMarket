# Databallr /market web hosting

The Expo app can be exported for `https://databallr.dev/market/` (staging) or
`https://databallr.com/market/` (production). The OAuth callbacks are exactly
`https://databallr.dev/market/oauth/callback` and
`https://databallr.com/market/oauth/callback`, with no trailing slash or query.
Register separate public OAuth clients with Authorization Code, S256 PKCE and
`openid profile email offline_access`; no client secret belongs in the app.
The existing localhost client at `http://localhost:8080/` remains usable with
its existing scopes. Registration is an operator prerequisite; a successful
export does not prove that the IdP has registered the supplied client.

From `app/`, supply explicit, environment-specific public inputs:

```sh
export MARKET_STAGING_OAUTH_CLIENT_ID='<actual registered staging public client ID>'
export MARKET_STAGING_API_URL='https://databallr-stock-market-api-staging.databallr.workers.dev/v1/apps/stock-market'
npm run export:market:staging
```

After the canonical staging API mount is verified, its allowed replacement is
`https://api.databallr.dev/v1/apps/stock-market`. The `/v2` API prefix is supplied
by the export. The OAuth audience remains the canonical resource even while the
browser calls the temporary workers.dev endpoint.

Production requires its own inputs, without a fallback to staging:

```sh
export MARKET_PRODUCTION_OAUTH_CLIENT_ID='<actual registered production public client ID>'
export MARKET_PRODUCTION_API_URL='https://api.databallr.com/v1/apps/stock-market'
npm run export:market:production
```

These commands validate the runtime auth configuration, discard inherited
`EXPO_PUBLIC_*` variables, disable dotenv loading for the child Expo process,
and set `experiments.baseUrl` to `/market`. Missing inputs, obvious placeholder
client IDs, and URLs from the wrong environment fail before bundling. They do
not verify client registration or backend availability. The original `app.json`
and default Expo config remain unchanged unless `MARKET_WEB_ENVIRONMENT` is
explicitly selected. Existing Pages exports retain `/NBAStockMarket` when the
Pages workflow supplies it.

The output is `app/hosting/.generated/<environment>/`: `assets/` contains the
verified export, `build.json` records public build inputs, and `wrangler.json`
points at the path-scoped Worker. Generated outputs are ignored by Git. A
failed Expo rebuild removes its deployable configuration first. Default
configurations have no routes, workers.dev, or preview URLs.
All generated configurations explicitly pin the Databallr Cloudflare account
`c106bf9fdebefc994effa68697f1d8fe` and bind their selected `ENVIRONMENT`.

To prepare a reviewed configuration for mounting the website, rebuild with
`npm run export:market:staging -- --with-routes` (or the production counterpart).
This only generates configuration locally; it does not deploy. Inspect the
result and complete the auth/API readiness checks before separately running
Wrangler against that configuration. Routes are exactly `databallr.dev/market`
and `databallr.dev/market/*` for staging, or the corresponding `.com` routes for
production. There is no `databallr.dev/*`, `databallr.com/*`, `/market*`, custom
domain, origin fetch, backend binding, or database access in this Worker.

Cloudflare route matching includes the query string. Consequently the exact
`/market` route cannot cover `/market?utm_source=...`; configure the existing
host's exact-path handler to redirect `/market` to `/market/` while preserving
the query. The path Worker also redirects bare `/market` to `/market/` when the
request reaches it. The canonical slash entry and callback are covered by the
`/market/*` pattern, including their query strings. Do not broaden the route
to `/market*`, which would also claim unrelated routes such as `/marketplace`.

The Worker strips the `/market` prefix before fetching from its `ASSETS`
binding. `/market/` and the exact callback serve `index.html` directly; the
callback's query remains intact for the existing popup/state/PKCE flow. HTML
uses `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Staging responses have
`X-Robots-Tag: noindex, nofollow`, and production adds no indexing restriction.
This policy reads the `ENVIRONMENT` binding, independent of the request hostname;
a missing or unknown binding retains the staging restriction. Missing assets
and unknown paths return 404, so a missing script cannot receive HTML. Only
GET and HEAD are accepted. Asset HTML canonicalization and general SPA fallback
are disabled to avoid redirecting the callback or masking missing assets.

Local checks:

```sh
npm test
npx tsc --noEmit
npm run test:hosting
# After a staging export, with a locally installed Wrangler 4:
wrangler dev --local --config hosting/.generated/staging/wrangler.json
```

Verify `/market/`, `/market/oauth/callback?code=...&state=...`, the JavaScript and
favicon references emitted in `index.html`, missing assets, and unrelated site
paths before mounting. Live OAuth and CORS verification require the real
registered client, restored staging auth resource support, and API readiness.

References: [Expo 54 baseUrl](https://docs.expo.dev/versions/v54.0.0/config/app/#baseurl),
[Expo 57 documentation required by app/AGENTS.md](https://docs.expo.dev/versions/v57.0.0/),
[Cloudflare asset bindings](https://developers.cloudflare.com/workers/static-assets/binding/),
[Cloudflare HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/),
and [Cloudflare route matching](https://developers.cloudflare.com/workers/configuration/routing/routes/).
The installed SDK used for implementation is Expo 54; no SDK upgrade is part of
this change.
