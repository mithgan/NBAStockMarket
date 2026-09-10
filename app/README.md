# NBA Stock Market mobile app

This directory contains the standalone Expo + TypeScript client. Authenticated Databallr Flask responses are the
only gameplay authority; the app does not read or write market state through Supabase directly.

## Run locally

Copy the public environment template, then provide the API URL, its v2 path prefix, and the
Supabase project URL plus its publishable key. Never place a Supabase secret or service-role key in
an `EXPO_PUBLIC_*` variable.

```sh
cd app
cp .env.example .env
```

For local web or iOS Simulator development, start the Databallr Flask backend on `127.0.0.1:8083`
and keep the template's API URL. Android Emulator users should set
`EXPO_PUBLIC_NBA_STOCK_API_URL=http://10.0.2.2:8083/api/nba-stock-market`.
Keep `EXPO_PUBLIC_NBA_STOCK_API_PREFIX=/v2` when the API URL includes that Flask mount path.
A physical device cannot reach your computer through `127.0.0.1`; use an HTTPS development
endpoint that the device can reach instead. Remote API and Supabase URLs must use HTTPS.

Then run:

```sh
npm install
npx expo start
```

The app presents an explicit configuration error when any public variable is missing or unsafe.
After sign-in, it restores the Databallr Supabase session and loads the per-game account from Flask.
The four gameplay tabs are Roster, Market, Results and Leaders. The score starts at $0; rules,
fees, position limits, costs and settlements come from the selected backend ruleset. Older device
prototype saves remain untouched and are not imported into the per-game account.

## Verify locally

```sh
npm test
npx tsc --noEmit
npx expo export --platform web
```

Application screens live in `src/screens/`; runtime-validated API contracts live in `src/api/`.

## GitHub Pages

The published web address is `https://mithgan.github.io/NBAStockMarket/`. A published build may
lag the source branch; check the displayed per-game tabs and rules rather than assuming the URL
contains the latest code.

The Pages workflow runs client tests and TypeScript checks before publishing. Publication requires
repository variables `NBA_STOCK_V2_ENABLED=true` and `NBA_STOCK_V2_API_PREFIX=/v2`, and the
Flask mount must return the v2 contract marker at `/api/nba-stock-market/v2/meta`. The marker
identifies the installed API; it does not prove database configuration, successful sign-in or
playable account state. Before enabling publication, verify an authenticated bootstrap and an
open/close flow against the intended backend and ruleset. Keep the existing authentication and
deployment gates in place while preparing a release.

The export uses the `/NBAStockMarket` base path. Use the shared Databallr Auth project and allow
the published origin in Flask CORS and the full callback path in Supabase's redirect configuration.
Never use the separate market database project's identity configuration in the browser.

## Optional private web preview

The Expo web client can also deploy as a standalone Vercel preview. Its API remains in the
existing Databallr Flask service.

Configure these public Preview environment variables in Vercel:

```text
EXPO_PUBLIC_NBA_STOCK_API_URL=https://api.databallr.com/api/nba-stock-market
EXPO_PUBLIC_NBA_STOCK_API_PREFIX=/v2
EXPO_PUBLIC_SUPABASE_URL=https://<databallr-auth-project>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<databallr-auth-project-public-key>
```

Use the existing Databallr Supabase Auth project here so users keep their
Databallr account identities and Flask verifies the same token issuer. The
dedicated NBA Stock Market Supabase project is database-only and its URL or
publishable key must not be used by the client.

Then deploy from this directory:

```sh
vercel login
vercel
```

After Vercel returns the immutable preview origin:

1. Add the bare origin to Supabase Auth's redirect URL allowlist.
2. Append the same origin to Flask's `PUBLIC_API_ALLOWED_ORIGINS`.
3. Deploy the Flask branch and verify authenticated CORS requests.

Do not put a service-role key, database URL, settlement key, or any other
privileged value in an `EXPO_PUBLIC_*` variable.
