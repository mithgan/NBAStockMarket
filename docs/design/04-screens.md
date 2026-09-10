# 04 — Screens

The anatomy of each surface as it ships today, and why it is shaped that way.

## The chrome (every tab)

Top to bottom: brand bar (`chrome`), tab bar (`chromeMid`, moves to the top
at ≥ 900px), season strip (`chromeSoft`), and the **standing earnings strip**
on the same `chromeSoft` step — `TONIGHT +$323K · 7 NIGHTS +$2.2M`, computed
from the account ledger and pinned on every tab.

The earnings strip replaced a transient settle toast: a recurring number
deserves a fixed address, not an announcement you can miss. The notice banner
returned to quiet mechanics — except the two moments it leads with money: the
settle recap ("Paid you +$2.2M across 4 nights.") and the return greeting
("While you were away: your players paid you +$878K across 5 nights."), which
fires only when nights actually settled since this device last saw the clock.

SeasonControl keeps the replay honest (LAST SETTLED / NEXT / DAY n of 174)
and collapses its five sandbox buttons behind one ADVANCE sheet under 900px.
Destructive actions (RESET ME, RESET SEASON) live behind explicit
confirmation modals with the danger tone.

## Portfolio — the balance sheet that leads with last night

Order of reading, top to bottom:

1. **Hero: the portfolio number.** 46px, compact, **unsigned** (a leading
   minus skews the hero's left edge), counting up on settles and tracking the
   finger live during a scrub. This is the screen's one loud thing.
2. **Three-cell stat bar:** `TONIGHT | THIS WEEK | <range>` — equal thirds
   (`flex: 1`) so a long label can never starve a neighbour into "+$42…",
   20px animated values over 11px labels, split by hairline rules, no boxes.
   The third cell doubles as the scrub readout (the date replaces its label
   mid-scrub). Tonight sits here — signed figures sit naturally in a bar —
   after the hero-inversion experiment showed a 46px signed red opener reads
   as an alarm (see 06-history).
3. **Balance line:** "$146.5M net worth · $91.6M cash" — one caption-tier
   line that also names what the chart plots.
4. **The chart**, sparkline-disciplined: line, fill, dashed start-of-range
   baseline (drawn only when the baseline crosses the plotted range), end
   dates beneath, 1W/1M/3M/Season tabs that appear only once history makes a
   shorter window mean anything. 168px; compresses to 112px on short phones.
   No grid figures, no footnote, no end-of-line value (it repeated the hero).
5. **Last-night strip:** the settlement ledger — up to three rows of
   "np vs proj → dividend" with the payer's 28px headshot, misses in red with
   identical structure, "+N more in the game log ›". The causal chain
   (box score → your cash) is the centrepiece, and the full **Game log**
   (every settled night, newest first, box-score lines) is one tap away.
   A stakes caption looks forward when your players are on the next slate:
   "Next Jan 22: Knueppel needs 11.3 to pay you."
6. **Your players:** a tinted region (surface tint + hairline edges, no
   border box), rows ordered by season dividends — your best payer leads.
   Each **HoldingRow** splits `DIVIDENDS` (what his nights did to your cash:
   total, $/night rate, "paid 20 of 32" hit rate) from `VALUE` (price vs
   cost incl. fee) — separated precisely so the flat-price fee line stops
   making every player read as a loser. The row's money figure is its only
   loud element.
7. **Recent activity**, collapsed by default behind its heading (the game
   log covers the need); meter bars were removed because they re-encoded the
   adjacent figure.

## Market — a shop, and only a shop

- **Four resting controls** (down from twelve): a `PAYS · L15 ▾` disclosure
  chip and the three task filters; sorts and the window picker live in a
  sheet. Rows start immediately — the count/column strip is gone.
- **Broadcast lower-third names:** quiet given-name kicker over the loud
  surname (KAWHI / **Leonard**), the TV-graphics pattern for scanning a
  league by surname.
- Row anatomy: avatar, lower-third name, dividend-first money (the price is
  the anchor figure), sparkline only when width ≥ 420 and font scale ≤ 1.3 —
  a squeezed trace misleads more than no trace.
- **BUY is gold**, never green — green means your money moved; a purchase
  hasn't moved it yet. Sold-out, blocked (shorted/boosted), and
  can't-afford states resolve from the authoritative account before the tap.
- STAR/MID tier bands live here (a shopping band belongs in the shop) and
  are defined in Settings with the other game facts — they were evicted from
  the roster when the owner had to ask what they meant.
- **Player profile** (also reachable from Portfolio and Watch — the same
  drill-in everywhere): stat tiles where every compact figure speaks its
  exact value, the trend chart with L5/L15/L30/Season windows and labelled
  HIGH/LOW extrema, and the `DIVIDENDS | PRICE` metric toggle — price plots
  honestly flat in direction-neutral gold until trading volume exists.

## Watch — the cost of watching

The page's money-first reason to exist is its headline: "+$3M paid out
unowned — the cost of watching," in **gold ink**, because green and red are
reserved for your money and unclaimed payouts are information. Row values
follow the same split: owned = green/red, unclaimed = gold. Watched players
on the next slate get a stakes line ("Leonard needs 18.2"); Remove is a
quiet ×; the limit is 8, stated plainly in the empty state.

The comparison chart (cumulative dividends, one line per watched player)
carries its bearings: a right value gutter the lines stop short of, the
window high and $0 labelled on their own rules, hairline top/bottom frame,
WINDOW START → LATEST GAME captions, and scrubbing that snaps to real
settled nights across every line at once. The lines stay smoothed — the
2026-09 review established the earlier "weird" read was missing orientation,
not curvature.

## Plays — a ledger, not a gallery

Open positions render as ledger rows (36px avatar, KIND kicker, 17px marked
money, clamp meter beneath) — the tall portrait cards fell to the same
critique the roster's cards did. Slot state is one line ("SHORTS 0/3 ·
BOOSTS 0/2"), and the rules paragraph waits behind "How plays work ▸" —
always-on instructions are noise after the first read.

## Leaders — the same grammar as your money

The hero row is the three-cell stat bar (`PORTFOLIO | VS $207.8M | LAST
NIGHT`) so the leaderboard speaks the portfolio's language. Ranks carry a
band tag ("Top 100" style via `rankBand`), the name column shows the min/max
gap bar, and *you* are marked in gold ink, not by colour-coding your P&L
differently from rivals'.

## Settings — facts, not options soup

Appearance (the four-treatment shortlist with palette swatches and an IN USE
tag), the season facts (starting bankroll, dollars per net point, tier
definitions — sourced from `state/economy.ts`), profile, and sign-out.
Everything else the app decides for itself.
