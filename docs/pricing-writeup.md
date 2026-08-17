# How Pricing Works

The market separates two signals instead of forcing them into one number:

1. **Trading demand moves the player price.**
2. **Performance versus the pregame projection moves holder cash through a daily dividend.**

Fair-value reversion is off. A strong game does not directly rewrite the market price; traders
decide whether that performance makes the player worth buying or selling.

## Demand moves price

Every trade moves the price multiplicatively:

```
new_price = price × exp(k × signed_quantity / liquidity)
```

- `signed_quantity` is positive for a buy and negative for a sell.
- `k = 0.003` is the provisional interactive-prototype setting selected by NBA-9's deterministic
  trader sweep. Re-run that sweep against observed order flow before production.
- `liquidity` grows with recent volume and ownership, so established markets move less per trade.

At minimum liquidity, one buy moves a price about 0.3%. A $68M player moves to roughly $68.20M.
At liquidity 5, the same buy moves that player to roughly $68.04M.

## Performance moves cash

After a game, every holder receives or loses virtual cash based on actual performance versus the
pregame Dunks & Threes projection:

```
dividend_per_holder = (actual_net_points - expected_net_points) × $80,000
```

Exact expectation pays $0. A positive surprise pays holders; underperformance debits them. This is
why an unexpected Collin Sexton 30-point game can pay more than an expected Luka Doncic 30-point
game without an algorithm automatically changing either market price.

## Other rules

- Everyone starts with $207.824M in virtual cash, matching the 2025-26 second apron.
- One share represents the whole player at his salary-like listed price.
- A user may own at most one share of a player.
- Prices also decay 0.5% per inactive day after the seven-day grace period.
- The absolute price floor is $350K.
- Every trade has a 0.25% fee; reversing the same player within 24 hours adds a 0.5% escalating flip surcharge capped at 1.5%.

NBA-9 found that `k = 0.003` stayed inside the prototype price guardrails. NBA-17 then softened the
fee and flip schedule after high-turnover stress exposed excessive wealth destruction. See
`output/trader-simulation.md` for the regenerated evidence.
