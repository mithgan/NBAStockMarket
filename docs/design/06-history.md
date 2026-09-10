# 06 — The decision log

How the UI arrived at its current shape, including the experiments that were
reversed. Reversals are documented deliberately: they are the strongest
evidence of what the system actually values.

## Era 1 — The navy terminal (origin → Aug 2026)

The app began as a dense navy data table in databallr's colours (Ryan's
palette: `#1b212c` navy, `#ffcd57` gold, DM Sans), four tabs, rules instead
of boxes, 8px radius ceiling, tabular numerals. The founding stance —
*a data terminal wearing a brand* — never changed afterwards.

## Era 2 — The treatments (the lost desktop session)

A single working session (never pushed; later recovered 1:1 from the
deployed bundle) built the variant system:

- **Tokens went indirect** — every colour through `var(--c-*)`, so a
  treatment is a palette write, not a component change. The base navy
  deepened to `#0e1218`; the original palette was preserved as the OG
  treatment rather than deleted.
- **Fourteen treatments** were built and kept: texture experiments (Slab,
  Brushed, Anvil), atmosphere experiments (Ambient, Haze, Aurora), a
  monochrome discipline test, ticker-tape monospace, and the researched
  cream **Light**.
- **The frame steps**: the three chrome bars each got their own token after
  a photo review showed them reading as one flat brown. Light's steps
  descend `#e0cfae → #e9dcc3 → #efe7d6` into the `#f3ecdf` page. The same
  day produced the fallback rule (a treatment's chrome falls back to its
  *own* surfaces) when every dark treatment's brand bar was caught sitting
  on base navy.
- **goldInk split from gold** so cream could darken text-gold for contrast
  without dimming gold paint.
- The Watch tab, the watchlist description rewrite ("Who has been paying,
  and how fast…"), L30 windows, and the roster panel arrived here, along
  with the discipline mottoes that stuck: *verified rendered, not just
  declared*; every treatment ≥ 4.5:1.
- Three refinements were in flight when the session died: watchlist heading
  spacing, chart axis structure, and the DIVIDENDS|PRICE toggle.

## Era 3 — Reconstruction (Aug 2026)

The deployed bundle was mirrored into the repo and decompiled back to
source; the rebuild was proven pixel-identical (SHA-256-equal screenshots,
string-identical bundles). Design impact: none by intent — but the era left
two artifacts: the printing-press skill (the system as replayable
instructions) and the contract tests re-pinned to the deployed reality.
The three lost refinements were rebuilt next, from the recovered chat's
description — the price plot rendering in direction-neutral gold dates from
here.

## Era 4 — The declutter (Sep 2026)

A research pass (NN/g, Refactoring UI, Tufte, fintech teardowns, Laws of UX
— summarized as "From Impact to Winning") converged on one law: **one loud
thing per screen**. The purge, in order:

- The market went **money-first**: "subtract until the money is the
  sentence." Twelve resting controls became four (disclosure chip + three
  task filters); the count strip died; names went broadcast lower-third
  (KAWHI / Leonard); **BUY went gold** and green was reserved for money
  movement forever.
- The settle banner learned to lead with money ("Paid you +$2.2M across 4
  nights."), then was largely retired in favour of a **standing earnings
  strip in the chrome** — a recurring number deserves a fixed address, not
  an announcement you can miss.
- **PAID became DIVIDENDS** everywhere: a label that cannot survive a
  negative night is the wrong label.
- The portfolio chart took the sparkline treatment; the hero's companions
  became the **three-cell stat bar** ("done the printing-press way" — cells
  split by hairline rules, not boxes), whose values count up and whose third
  cell doubles as the scrub readout.
- The roster's border box became a **surface tint with hairline edges** —
  the middle path on the panel question. Activity collapsed behind its
  heading; its meter bars died for re-encoding the adjacent figure.
- The end-of-line chart figure died for repeating the hero (non-redundancy);
  STAR/MID left the roster when the owner had to ask what it meant — the
  labels-last-resort test failing in the field.
- Rosters ordered by season dividends: your best payer leads.

## Era 5 — The inversion debate (Sep 2026)

The one genuine architectural fight, run as an experiment:

1. **The council's inversion:** an LLM-council review argued that with flat
   prices net worth cannot move, so *tonight's result* should be the 46px
   hero — signed, coloured, counting up — and the balance sheet should
   demote to one line. Also from this round, two keepers: the **settlement
   ledger** (the single highlight row became the night's full "np vs proj →
   dividend" ledger) and **stakes** ("Next Jan 22: Knueppel needs 11.3 to
   pay you.").
2. **First correction:** a 46px signed red figure as the app's opening line
   read as an alarm. Tonight dropped to the 34px display tier.
3. **The owner's revert-refine:** after living with it — *net worth reads
   better as the hero.* The 46px unsigned portfolio number returned,
   count-up and scrub-live; TONIGHT rejoined the stat bar as its first cell,
   where signed figures sit naturally.

What survived the reversal: the ledger, the stakes line, the demoted balance
line, and a principle worth recording — **the hero is the number the user
identifies with, not the number that moves most.** Volatility belongs in the
bar; identity belongs in the hero.

## Era 6 — Propagation and live wiring (Sep 2026)

- The portfolio's grammar reached the other tabs: Watch gained its
  money-first headline ("+$3M paid out unowned — the cost of watching", in
  gold ink because unclaimed payouts are information, not your money);
  Plays' portrait cards became ledger rows; Leaders' chip row became the
  stat bar.
- The watchlist chart got its bearings (value gutter, labelled $0 and high,
  window captions) — and the owner's call kept the smoothing: the earlier
  "weirdness" was missing orientation, not curvature.
- Holding rows completed the dividend triad: how much when he plays
  ($/night), how often he delivers ("paid 20 of 32"), what it has totalled.
- The app was wired to the live Flask backend; the economy constants moved
  to `state/economy.ts` (bankroll $207,824,000, $80K per net point) so copy
  and math share one source.
- Forward-looking touches: the season strip's "Next Jan 15: Knueppel plays
  for you," and the away-greeting ("While you were away: your players paid
  you +$878K across 5 nights.") — the app now opens by answering the
  question the user returned with.

## The rules the history keeps proving

1. Foundation changes pay forever: the token indirection from Era 2 is why
   every later redesign was cheap, and why `theme.ts` and `variants.ts` have
   not changed since.
2. Experiments are run for real and reverted without ceremony; what survives
   a reversal (the ledger, the stakes) is the actual finding.
3. Every rename is a semantics fix, not a style pass (PAID→DIVIDENDS,
   HoldingCard→HoldingRow, SEE ALL NIGHTS→Game log).
4. Field confusion beats theory: one owner question ("what does MID mean?")
   outweighs any argument for keeping a label.
