# Passover 05 — The App and Deployment

The user-facing MVP: an Expo/React Native app (web + mobile from one codebase) in `app/`.
Live deployment (with the backsim): **https://nba-stock-backsim.vercel.app**.

## Architecture in one paragraph

There is **no backend**. The app ships its market inside the bundle as two GENERATED
TypeScript files, produced by Python scripts from the canonical research artifacts. Screens
are thin; game logic is pure functions under `src/state/`; React state is one context.

```
output/opening-prices-2026-27.csv ─┐
output/backtest-2026.json ─────────┼─ scripts/generate_app_snapshot.py ─→ app/src/data/snapshot.ts
data/raw/2025-26 game logs ────────┘                                        (top 30 players + demo rivals)
data/raw/2025-26 + data/raw/dnt ──── scripts/generate_app_trends.py ──→ app/src/data/trends.ts
                                                                          (per-player full-season game
                                                                           logs w/ real dividends, 12.8K lines)
```

## File tour

- `App.tsx` — shell: header, **SimBar**, 3 tabs (Portfolio / Market / Leaders).
- `src/state/portfolio.ts` — pure trading logic: $140M start, buy/sell one share at listing
  price, one-share-per-player, summary math, leaderboard ranking. Tested.
- `src/state/sim.ts` — **the backsim clock** (added on `mith/experiments`): UTC-safe date
  math, season bounds (eve-of-opener 2025-10-20 → 2026-04-12, 174 days), windowed dividend
  collection `(from, to]` from the trends data, chart clipping. Tested.
- `src/state/PortfolioContext.tsx` — React context: portfolio + sim date + advance/reset;
  advancing credits held players' REAL game dividends to cash and records the settlement
  feed.
- `src/components/SimBar.tsx` — replay readout, gold progress track, +1 DAY / +1 WEEK /
  RESET; disables at season end.
- `src/screens/MarketScreen.tsx` — market list (ESPN headshots, tier pills, 15-game
  dividend sparklines, Buy/Sell with "NEEDS $X" affordability state) + `PlayerDetail`
  (Robinhood-style cumulative dividend chart, L5/L15/Season toggle, HIGH/LOW annotations,
  season stat grid). All charts clip to the sim date — no future-peeking.
- `src/screens/PortfolioScreen.tsx` — value hero, cash/holdings/dividends cards, roster,
  "Latest settlements" feed (real games settled in the last advance).
- `src/screens/LeaderboardScreen.tsx` — podium + table vs 4 hardcoded demo rivals.

## The backsim loop (what makes it a game)

Draft a roster at listing prices on opening eve → advance day/week → your players' actual
2025-26 games pay their actual surprise dividends ($40K/NP, D&T-projection expectations,
same formula as the engine) → watch cash, the DIVIDENDS stat, and the settlement feed →
out-dividend the market by April.

## Traps before you edit

1. **Never hand-edit `snapshot.ts` / `trends.ts`** — regenerate. Worse:
   `generate_app_trends.py` parses `snapshot.ts` WITH A REGEX; even reformatting snapshot's
   player lines breaks trend regeneration. Most fragile coupling in the app.
2. **`uiContracts.test.ts` pins exact source patterns** in `App.tsx` and `MarketScreen.tsx`
   (style lines, accessibility labels, the `['L5','L15','Season']` literal, no `hitSlop=` in
   App.tsx...). Run `npm test` after any edit to those files; put new UI in new files (the
   SimBar approach).
3. **No persistence** — refresh resets to $140M/day 0. No fees/price movement in-app; the
   full economy lives in the Python engine only. Instruments are not in the app.
4. Only **30 players** are listed in-app (generator limit) out of the 300-player CSV.
5. `app/AGENTS.md` says "read Expo v57 docs" but `package.json` pins Expo ~54 — one is
   stale; confirm with Ryan before Expo-API work.

## Build, test, deploy

```
cd app
npm install
npm test                      # 16 tests: portfolio, sim, trend presentation, UI contracts
npx tsc --noEmit              # typecheck
npx expo export --platform web    # → app/dist  (static site)
cd dist && npx vercel deploy --prod --yes    # project: nba-stock-backsim
```

Vercel: account `mithranganesan81-9274`; project `nba-stock-backsim`; `dist/vercel.json`
adds an SPA rewrite. The hash deployment URLs sit behind Vercel auth (302) — share the
public alias `nba-stock-backsim.vercel.app` (200). As of 2026-07-17 there is NO other NBA
project on this Vercel account; if an earlier MVP deploy exists it's on someone else's
account.

## Natural next app steps

Autoplay (×7 animation through the season) · per-holding dividend totals on roster rows ·
replayed synthetic rivals racing the same season on the leaderboard · persistence
(AsyncStorage) · widen listing beyond 30 players · instruments UI (after the engine-side
launch blocker clears).
