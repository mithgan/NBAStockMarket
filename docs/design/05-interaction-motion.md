# 05 — Interaction and motion

Motion in this app is a reading aid, never a personality. Everything animated
either follows the reader's own input (scrubbing), confirms a change of state
(count-ups), or acknowledges the pointer (hover). Nothing loops, nothing
plays on its own.

## Hover (web, pointer-gated)

All hover rules live in the injected global stylesheet and are gated on
`@media (hover: hover) and (pointer: fine)` — a touch device must never
paint the last-tapped row as though it were still under a cursor.

- **Rows** (`[data-row]`, applied via the `rowMarker` dataSet helper): the
  row answers the pointer with `--c-surface`, 120ms ease-out. A list of
  thirty players that only responds on click reads as a printed table.
- **Player cards** (`[data-card="player"]`): a 2px lift
  (`translateY(-2px)`), gold border, raised surface — 140ms with the shared
  spring-ish curve. 2px is enough to read as a response, small enough that a
  grid of ten does not appear to wobble. Transform and border only: a shadow
  would need a real offset and blur to be honest depth, and this flat world
  has none.

## Scrubbing (the charts)

The portfolio chart, watchlist comparison, and profile trend all scrub the
same way:

- The pointer position snaps to the **nearest real settled date**
  (`nearestPointIndex`), never interpolating — every readout names a night
  that actually happened. Edge overshoot clamps to the edge point.
- The snap is animated: SVG `cx/cy/x1/x2` transition 110ms
  `cubic-bezier(0.22, 1, 0.36, 1)`, so the marker glides between honest
  points instead of teleporting. The honesty of the snap is kept; the
  glitch-read of the jump is not.
- Two input paths feed one pair of handlers: DOM pointer events via
  `useChartSurface` (hover on web) and a `PanResponder` (touch drags).
  Handler identity is stable; geometry flows through a ref so pointer
  listeners never re-subscribe mid-scrub.
- Scrub state is display-only: releasing the pointer restores the resting
  readout. During a scrub the stat bar's third cell swaps its label for the
  scrubbed date, and count-ups are disabled so the figure tracks the finger
  with zero lag.

## Count-ups

`useCountUp(target, disabled, 620ms)`: money figures animate to new values
on settles — the hero, the stat bar's three cells, tonight/week earnings.
620ms is long enough to notice the money moved, short enough to be done
before the eye leaves. Disabled while scrubbing (the finger is the
animation) and silenced entirely by reduced motion.

## The spinner rule

The loading spinner is the only self-propelled motion in the app, which is
exactly why the reduced-motion setting must silence it: under
`prefers-reduced-motion` it renders as the static text `WORKING…`.

## Reduced motion / reduced transparency

- A global CSS rule collapses every animation and transition to 0.01ms under
  `prefers-reduced-motion` — the scrub snap, hovers, and count-ups all
  degrade to instant, and the app remains fully usable.
- `useReducedMotion` (matchMedia with the legacy-listener fallback) gates
  JS-driven motion at the source.
- `prefers-reduced-transparency` removes the ambient treatments' colour
  fields outright: atmosphere is decoration, and a reader who asked for less
  transparency has asked not to have colour drifting behind their money.

## Focus

react-native-web renders Pressables with `outline: none`, so the global
stylesheet restores a visible indicator on every interactive role:
2px solid `--c-focus`, 2px offset, 4px radius. Keyboard reachability is a
contract, not a theme choice — the focus colour is a token (`#7cc4ff`, remapped
per treatment) so it stays visible on every background.

## Breakpoints and adaptation

One set of thresholds, used consistently:

| Threshold | Effect |
|---|---|
| width < 420 | Sparklines leave market rows and holding rows — a squeezed trace misleads more than no trace |
| width ≥ 900 | Tab bar moves to the top; market gains the ownership column; SeasonControl un-collapses its sandbox buttons |
| width ≤ 1040 | The app column's maximum; beyond it, hairline-bordered margins |
| fontScale > 1.3 | Sparklines drop, grids re-derive column counts from a 220px minimum instead of fixed breakpoints |
| short phones | The portfolio chart compresses 168 → 112px and the axis simplifies to two rules |

Row grids never truncate to keep a layout: the market's action column widens
with font scale (`marketActionWidth`), row heights are computed
(`marketRowHeight`) so virtualization stays exact, and `maxFontSizeMultiplier`
caps are set per text role (hero 1.4, row money 1.6, stat labels 1.2) so
accessibility scaling enlarges what carries meaning before what decorates.
