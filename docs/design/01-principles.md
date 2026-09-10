# 01 — Principles

Every rule below is enforced somewhere: in a token, a contract test, or a
review habit. None of them are aspirations.

## Money is the sentence

The app exists to answer one question — *what did your players pay you?* —
so money figures are the subjects of sentences, not decoration beside them.

- Copy leads with the figure: "Paid you +$2.2M across 4 nights." — the
  mechanical count ("Settled 7 game dates") is the trailing clause, never the
  opener.
- The night headline is a transaction row: payer's headshot, name, and the
  amount inline-emphasized in its own colour and weight — "Nikola Jokic gave
  you **+$428K**".
- Subtract until the money is the sentence: if a line's money figure still
  needs a label to be understood, the line has too much else in it.

## One loud thing per screen

The declutter overhaul's core law (from the five-school research pass: NN/g,
Refactoring UI, Tufte, fintech teardowns, Laws of UX). Each screen picks one
element allowed to be loud — the portfolio's 46px hero, a market row's price,
a holding row's dividend figure — and everything else steps down to the body
or caption tier. Two loud things on one surface is a bug.

The three-size discipline is the mechanism: a surface uses at most three type
roles at rest (hero/display for the one loud thing, value/body for content,
label for captions). When a figure was found rendered at three sizes on one
screen (the old hero + change row + gutter figure all showing portfolio
value), two of them were removed, not restyled.

## The colour grammar

Colour is a vocabulary, and each word has one meaning:

- **Green and red mean YOUR money moved.** Nothing else. A green button is a
  bug (BUY is gold); a red informational note is a bug.
- **Gold is the action and identity colour** — primary buttons, the active
  tab rule, selection, the brand mark. `goldInk` is its text-safe twin,
  darkened by light treatments so 11px text still clears contrast.
- **Information that is not your money is gold ink or cyan**, even when it is
  a dollar figure. The Watch page's "+$3M paid out unowned — the cost of
  watching" is gold, because unclaimed payouts are information, not your
  ledger. Owned rows on the same screen stay green/red.
- **Direction-neutral data is gold.** The price plot on the player profile is
  flat by construction, so it renders in gold rather than pretending an up or
  down.

## Honesty rules

- **Every readout names a night that actually happened.** Chart scrubbing
  snaps to real settled dates; there is no interpolation between points.
- **No invented smoothness, no invented depth.** Charts with too few points
  draw straight segments; the flat world has no shadows because it has no
  honest light source (hover lift is transform + border only).
- **Non-redundancy:** a figure appears once per surface. The chart's end-of-
  line gutter figure died because it repeated the hero 300px above it.
- **A control that can only ever show nothing does not ship** — until the
  data can move, the control waits (the price toggle shipped only when it
  could be honest about being flat: neutral gold, clearly labelled).
- **Signed language:** the game pays negative dividends, so the label is
  DIVIDENDS, never PAID — a word that cannot survive a losing night is the
  wrong word.

## Labels are a last resort

A label earns its place only when the value cannot carry the meaning alone.
The field test: if the owner has to ask what a label means (STAR/MID on a
roster row), the label is wrong — it moved to where shopping context exists
(the market) and its definition lives with the other game facts in Settings.
Stat-bar labels are quiet 11px captions under loud values, never the other
way around.

## Structure is rules, not boxes

Surfaces are divided by hairline rules and background steps, not by rounded
containers. The radius ceiling is 8px and most structure uses none. When the
roster needed to read as a region, the answer was a surface tint with
hairline edges — "the middle path on the panel question" — not a border box.
The three-cell stat bar is cells split by hairline rules; a boxed version was
considered and rejected as noise.

## Dense, scannable, tabular

This is a data terminal wearing a brand, not a marketing page. Rows target
44px minimum touch height; market rows are 64px (70px with ownership) with
an explicit height so the list virtualizes exactly. Every live number uses
tabular numerals so columns hold still while values change. The one screen
allowed real air is the portfolio hero.

## Access is part of the design, not a pass afterwards

- Every text/background pair in every treatment measures ≥ 4.5:1 — enforced
  by test for the base palette and by review for treatments (all three chrome
  bars carry text, so all three are measured).
- Every compacted money figure carries its exact value for assistive tech
  ("$1.4M" speaks as "$1,400,000" via accessibilityLabel) — contract-tested
  per figure, not per screen.
- Font scaling is honoured to 1.3× before layouts adapt (sparklines drop,
  grids recount their columns) rather than truncate.

## Verified rendered, not just declared

A colour or layout change is not done when the code says so; it is done when
the pixel on screen says so. CSS custom properties can be overridden by a
stale seed or a variant fallback, so changes are measured on the exported
build (screenshot or getComputedStyle). This habit caught the chrome-fallback
bug the day the tokens were introduced, and it is why the reconstruction
could be proven pixel-identical.
