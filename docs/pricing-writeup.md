# How Pricing Works

A player's price is a tug-of-war between two forces: **what traders do** (short-term) and
**how the player actually performs** (long-term). Neither one alone sets the price — they pull
against each other every day.

---

## Force A — Demand (moves the price minute to minute)

Every trade moves the price. Buying pushes it up, selling pushes it down. The more shares in the
trade, the bigger the move:

```
new_price = price × exp( k × shares / L )     # +shares = buy, −shares = sell
```

- `k ≈ 0.0003` — base sensitivity (~0.03% per share)
- `L` — the player's **liquidity/depth**, which grows with how actively they're traded

**Why the `L`?** A superstar everyone trades is "deep" — hard to move. An ignored player is
"thin" — moves fast. This stops someone from cheaply walking an obscure player's price up and
down to game it.

**Feel of it:**
- Buy 20 shares of a lightly-traded $100 player → ~$100.60
- Buy the same 20 shares of a heavily-traded player → ~$100.12 (moves 5× less)

This is what makes being **early** pay: if you buy before the crowd, later buyers push your
position up.

---

## Force B — Performance (pulls the price toward reality)

Each player has a **live fair value (FV)** computed from real basketball stats — not a number
someone typed once and forgot:

```
FV = talent tier + rolling performance (WARP) + minutes/availability + age curve + recent form
```

Every day, the price is nudged a small step toward FV:

```
price ← price + λ × (FV − price)      # λ ≈ 0.03 per day
```

- Player plays great → FV rises → price gets pulled **up**, even with no buyers.
- Hyped player underperforms → FV falls → price drifts **down**.

`λ` is small, so the market still leads day to day — but a price can never stay divorced from
reality forever. This replaces the old "decay" idea: an ignored, overpriced player naturally
sinks toward FV; an ignored, underpriced one rises toward it.

There's a **floor** so no one gets zeroed:

```
floor = max( 0.5 × FV , $25 )
```

---

## Putting it together

- **Short term**, price = crowd conviction and speculation (fun, tradeable).
- **Long term**, price = actual on-court value (skill-rewarding, self-correcting).
- Being **right about a player before the crowd pays twice**: once when demand catches up
  (Force A lifts the price), and again when the stats confirm it (Force B locks it in).

## Costs

- **1% fee** on every buy and sell.
- **Flip penalty** if you reverse a trade on the same player within 24h (escalates if you keep
  churning) — discourages self-pumping.

---

*Starting bankroll is $10,000 for everyone. Your net worth = cash + (shares × current price).*
