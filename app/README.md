# NBA Stock Market mobile app

This directory contains the Expo + TypeScript client. Authenticated FastAPI responses are the
only gameplay authority; the app does not read or write market state through Supabase directly.

## Run locally

Copy the public environment template, then provide the API URL and the Supabase project URL plus
its publishable key. Never place a Supabase secret or service-role key in an `EXPO_PUBLIC_*`
variable.

```sh
cd app
cp .env.example .env
```

For local web or simulator development, start FastAPI on `127.0.0.1:8011` and keep the template's
API URL. A physical device cannot reach your computer through `127.0.0.1`; use an HTTPS development
endpoint that the device can reach instead. Remote API and Supabase URLs must use HTTPS.

Then run:

```sh
npm install
npx expo start
```

The app presents an explicit configuration error when any public variable is missing or unsafe.
After sign-in, it restores the Supabase session, loads the account from FastAPI, and keeps the
legacy prototype save untouched until the user confirms the one-time server-account transition.

## Verify locally

```sh
npm test
npx tsc --noEmit
npx expo export --platform web
```

Application screens live in `src/screens/`; runtime-validated API contracts live in `src/api/`.
