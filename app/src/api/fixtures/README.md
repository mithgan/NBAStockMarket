# Per-game API fixtures

`flaskPerGameBootstrap.json` is an actual response from the isolated local Flask/PostgreSQL integration harness on September 10, 2026. All accounts in that harness are synthetic. The fixture contains no token or credentials. It preserves the Flask serializer's opaque leaderboard `entry_id` contract.

`perGameApiExample.json` retains the historical example's rich position/result scenarios for unit tests, with the current schema marker (`schema_version: 2`) and opaque leaderboard IDs. It replaces the older documentation fixture for client tests; it is not a live account or a fallback for the app.
