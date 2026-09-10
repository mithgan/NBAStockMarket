# 02 — Tokens

Source of truth: `app/src/theme.ts`. Everything here is exact.

## The two-layer colour architecture

Every colour exists twice, on purpose:

- **`BASE_PALETTE`** — literal hex values of the default world. Native
  platforms and anything doing colour math read these.
- **`colors`** — the same tokens wrapped as `var(--c-<name>, <hex>)` on web.

A design treatment restyles the entire app by rewriting the `--c-*` (and
`--f-*` font) custom properties on `:root` (`theme/applyVariant.ts`); no
React re-render carries a palette. This one decision is why the app can hold
14 visual treatments with a single stylesheet's worth of component code, and
why the token files have not needed to change while the screens above them
were redesigned repeatedly.

`web/globalStyles.ts` seeds `:root` with the base palette at startup, so a
component rendered before any variant applies still resolves every token.

## Base palette (the navy world)

| Token | Value | Role |
|---|---|---|
| `background` | `#0e1218` | Page |
| `surface` | `#151b24` | Rows, tiles, inputs |
| `surfaceRaised` | `#1d2531` | Pressed / selected |
| `surfaceHigh` | `#222b39` | Modals, sheets |
| `chrome` | `#151b24` | Brand bar (frame step 1) |
| `chromeMid` | `#151b24` | Tab bar (frame step 2) |
| `chromeSoft` | `#0e1218` | Season strip (frame step 3) |
| `border` | `#212936` | Hairlines and rules |
| `borderStrong` | `#323c4e` | Structural edges |
| `text` | `#f7f8fa` | Primary text |
| `muted` | `#aab2c0` | Secondary text |
| `faint` | `#8d97a8` | Dimmest legible tier — carries real 11px text, so it is contrast-tested, never decorative |
| `gold` | `#ffcd57` | Action, identity, selection |
| `goldInk` | `#ffcd57` | Text-safe gold (light treatments darken it to `#6a4e0d`) |
| `goldSoft` / `goldLine` | `#2f2610` / `#6b571f` | Gold fills and edges |
| `cyan` / `cyanSoft` | `#3abff8` / `#12303f` | Information accent |
| `green` / `greenSoft` | `#3ddc97` / `#0f3225` | Your money, up |
| `red` / `redSoft` | `#ff8189` / `#33181e` | Your money, down |
| `focus` | `#7cc4ff` | Keyboard focus outline |

`goldInk` exists because gold-as-ink and gold-as-paint have different jobs:
large display numbers and filled buttons keep `gold`, while 11–13px text that
happens to be gold (labels, active tab text, "Breakdown" toggles) reads
through `goldInk` so the Light treatment can darken only the ink and keep the
paint. The ink/paint split was applied at exactly five positions in
`ui/primitives.tsx`; everywhere else gold is paint.

## Typography

Display face: **DM Sans** (400 / 500 / 700 / 800 / 900, Google Fonts) —
databallr.com's face. Body: the system stack. Both flow through
`var(--f-display)` / `var(--f-body)` so the Tape treatment can swap the whole
app to `"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`.

Type scale (`type`):

| Role | px | Typical use |
|---|---|---|
| `label` | 11 | Kickers, captions, stat labels — 800 weight, uppercase, +1.1 tracking |
| `body` | 13 | Copy, metadata |
| `value` | 15 | Row money, secondary figures |
| `title` | 17 | Headings, loud row money |
| `display` | 34 | Screen-level figures |
| `hero` | 46 | The one number (portfolio value) — 700 weight, −1.6 tracking |

Weights are named (`regular` 400 → `black` 900); nothing below 11px exists,
and the contract tests grep the screens to keep it that way. Headings are 17px
at 800 with −0.3 tracking; there is deliberately no 20px+ heading tier — big
sizes are reserved for numbers, because numbers are the content.

**Numerals:** every live figure sets `fontVariant: ['tabular-nums']` (the
`numeric` helper). A column of changing values must not shimmer.

## Space and radius

- Spacing scale: `4 / 8 / 12 / 16 / 24 / 32` (`xs`–`xxl`). Dense surfaces run
  on 8 and 12; only the hero area uses 24+.
- Radius scale: `0 / 3 / 4 / 6 / 8`. **8px is the ceiling** — this is a flat,
  ruled interface, not a card UI. The single exception is the circular brand
  mark, whose radius is *derived* (`BRAND_MARK_SIZE / 2`) precisely so no
  literal above 8 exists for the contract test to find.

## Layout constants

- App column: `maxWidth: 1040`, hairline side borders — the terminal reads as
  a fixed instrument on wide screens, not a fluid page.
- Tab bar: bottom on phones, top at ≥ 900px (a desktop product keeps
  navigation at the top; the thumb-reach argument only exists on a phone).
- Market rows: 64px base, 70px with the ownership column, explicit heights so
  FlatList virtualization is exact; the action column widens with font scale
  instead of truncating.

## Economy constants (for copy)

From `src/state/economy.ts`, matching the live backend: starting bankroll
**$207,824,000**, base dividend **$80,000 per net point**, weekly-short line
**$40,000 per net point**. Copy that quotes these must import them — the
Settings sheet's "game facts" and the leaderboard's VS cell derive from the
constants, never hardcode.
