# NBA Stock Market Mobile MVP Design

> Historical design snapshot. The current economy uses a $207.824M bankroll and
> $80K/NP owned-player dividends; see `docs/PLAN.md` and `docs/pricing-writeup.md`.

This is the tracked product design for NBA-10. The operational source used by workers is `.context/orchestration/20260720-mobile-mvp/DESIGN.md`; the two documents intentionally describe the same approved scope.

## Outcome

The existing Expo demo becomes a complete offline replay of the 2025-26 season. A user builds a roster with a $140M virtual bankroll, advances through real historical game dates, receives signed actual-vs-projected dividends, manages weekly shorts and boosts, and can close/reopen without losing progress.

## Included

- One whole-player share per user and 0.25% buy/sell fees.
- Real committed historical player event data.
- One-date-at-a-time, duplicate-safe settlement.
- Three Monday-Sunday performance shorts with fee, collateral, clamps, and void handling.
- Two Monday-Sunday one-game boosts that double signed dividends.
- Portfolio history, activity history, and a dynamic prototype leaderboard.
- Versioned local persistence, hydration feedback, save-failure feedback, and confirmed reset.
- Mobile-first responsive and accessible UI verification.

## Excluded

- Accounts, backend persistence, live data, production multiplayer, notifications, real-money behavior, and deployment.
- The season-long price short remains hidden per `docs/shorting-spec.md` launch gating.

## Rule Fidelity

The TypeScript state machine mirrors `nba_stock_market/engine.py` and `nba_stock_market/instruments.py`. The Python implementation remains authoritative; TypeScript adds no new economy constants. Historical trend rows are treated as qualifying games because the generated mobile cache does not include minute projections.

## Finish Line

All scoped workflows work in the rendered app, persist correctly, have automated coverage, pass Expo export and Python regressions, and survive an independent autoreview plus repeated first-time/returning-user UX passes with no unresolved high- or medium-impact findings.
