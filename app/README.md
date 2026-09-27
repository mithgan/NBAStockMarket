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

## Practice mode

Open the web app with `?mock` (for example `http://localhost:8081/?mock`) to play a generated
season in browser memory with no sign-in. It replays last season's calendar, starts every
leaderboard entry at $0, and starts over on reload; it never touches a saved account. The practice
bar advances one night or one week at a time, and Restart asks for a second tap before it reloads.

## The per-game screens

Every screen answers one question, in the same words everywhere (`src/copy/terms.ts`: "Short",
never "inverse"; "$105K a game"; "Nov 6", never an ISO date). Shared per-game numbers come from
`src/data/perGameMetrics.ts`, so the screens agree to the dollar.

- **Roster**: how am I doing? Your score, rank, last night and last 7 days, then the score split
  by source (roster, shorts, closed positions, fees), each equal to the list beneath it. Every
  player shows his locked price, dividend a game, net a game and total under a Paying off /
  Losing money tag; shorts and closed positions have their own lists. Drop and Close ask for a
  second tap.
- **Market**: who is worth adding? Roster/Short toggle, search, sort by price, value or name, and
  a Watching filter. Each row shows the price a game and last season's value against it.
- **Player profile**: is he worth his price, game by game? Read from the side you hold him on, at
  the price you locked, with his form at market price for games you did not hold him.
- **Results**: what happened last night? Game nights newest first, each with its total; a row
  reads by its effect on you, and the full arithmetic opens on tap. Corrections, did-not-play,
  unsettled and fee rows all stay visible.
- **Leaders**: where do I stand? Your rank, the gap to the next rank and to #1.
- **Status and practice bars** stay under 100px on a phone; the game rules open as a sheet.
  Notices float as toasts: a success clears itself and lets taps through, a problem waits to be
  dismissed, and every notice is announced to screen readers.

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
