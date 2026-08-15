# NBA Stock Market mobile app

This directory contains the standalone Expo + TypeScript client. Authenticated Databallr Flask responses are the
only gameplay authority; the app does not read or write market state through Supabase directly.

## Run locally

Copy the public environment template, then provide the API URL and the Supabase project URL plus
its publishable key. Never place a Supabase secret or service-role key in an `EXPO_PUBLIC_*`
variable.

```sh
cd app
cp .env.example .env
```

For local web or iOS Simulator development, start the Databallr Flask backend on `127.0.0.1:8083`
and keep the template's API URL. Android Emulator users should set
`EXPO_PUBLIC_NBA_STOCK_API_URL=http://10.0.2.2:8083`.
A physical device cannot reach your computer through `127.0.0.1`; use an HTTPS development
endpoint that the device can reach instead. Remote API and Supabase URLs must use HTTPS.

Then run:

```sh
npm install
npx expo start
```

The app presents an explicit configuration error when any public variable is missing or unsafe.
After sign-in, it restores the Databallr Supabase session, loads the account from Flask, and keeps the
legacy prototype save untouched until the user confirms the one-time server-account transition.

## Verify locally

```sh
npm test
npx tsc --noEmit
npx expo export --platform web
```

Application screens live in `src/screens/`; runtime-validated API contracts live in `src/api/`.

## Private web play-test

The Expo web client deploys as a standalone Vercel preview. It is not a
Databallr page; only its trusted API lives in the Databallr Flask service.

Configure these public Preview environment variables in Vercel:

```text
EXPO_PUBLIC_NBA_STOCK_API_URL=https://api.databallr.com
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
