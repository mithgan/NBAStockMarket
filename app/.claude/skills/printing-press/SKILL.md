---
name: printing-press
description: Apply the Databallr NBA Stock Market design system — the exact treatments, palettes, chrome steps, and verification discipline recovered from the deployed mith-exp-databallr.vercel.app build. Use when styling or extending this app's UI, adding a design variant, or checking that a change keeps every treatment legible.
---

# Printing Press — the Databallr Stock Market design system

This skill is a 1:1 capture of the UI element system that shipped at
mith-exp-databallr.vercel.app. Every value below was extracted from the
deployed bundle, not remembered. Source of truth in the repo:
`src/theme.ts`, `src/theme/variants.ts`, `src/theme/applyVariant.ts`,
`src/web/globalStyles.ts`.

## How the system works

- All colours flow through CSS custom properties: `var(--c-<token>, <hex>)`.
  A design variant restyles the whole app by rewriting `--c-*` / `--f-*` on
  `:root` (`applyVariant`) — no React re-render carries the palette.
- `BASE_PALETTE` (Flat navy) is the fallback world; native platforms read it
  directly.
- Fonts: display face is DM Sans (400/500/700/800/900, Google Fonts), body is
  the system stack. The Tape variant swaps both for
  `"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace`.

## Frame steps (the "printing press" chrome)

The app frame has three stacked bars, each with its own token, descending into
the page:

| Bar          | Token        | Light value | Dark value  |
|--------------|--------------|-------------|-------------|
| Brand bar    | `chrome`     | `#e0cfae`   | `#10141b`   |
| Tab bar      | `chromeMid`  | `#e9dcc3`   | `#10141b`   |
| Season strip | `chromeSoft` | `#efe7d6`   | `#07090d`   |
| Page         | `background` | `#f3ecdf`   | `#07090d`   |

Fallback rule (this fixed a shipped bug): a variant that does not set chrome
tokens gets `chrome`/`chromeMid` = its own `surface` and `chromeSoft` = its own
`background` — never the base palette's.

## The 14 treatments

Order: Flat, OG, Immersive, Monochrome, Ambient, Haze, Aurora, Tape, Slab,
Anvil, Brushed, Default(grain), Dark, Light. Default variant id: `grain`.
Appearance picker shortlist: `grain`, `dark`, `nocturne` (Aurora), `light`.

Key palettes (background / surface):
- Flat + Default(grain): `#0e1218` / `#151b24` (grain adds brushed texture)
- OG: `#1b212c` / `#232a39` (Ryan's original navy)
- Immersive + Dark: `#07090d` / `#10141b` (Immersive: chartHeight 250)
- Tape: `#0c0d10` / `#15171c`, monospace everything
- Slab: `#111214` / `#191b1f`, plate texture (top-lit gradient)
- Brushed: `#0f1214` / `#171c20`, brushed texture (3px grain + raking light)
- Anvil: `#131211` / `#1c1a17` (browner Slab, plate texture)
- Monochrome: `#0f1114` / `#161920`; green→gold `#ffcd57`, red→grey `#9aa1ab`
- Ambient: `#0a0d14` / `#141926`, glow up .17 / accent .10, blur 64, size 340
- Haze: `#0c0f16` / `#161b27`, mint `#93d9b8` / rose `#f0a9ae`, blur 104
- Aurora (`nocturne`): `#161d2b` / `#1f2736`, plate + glow (accent `#e8833a`, blur 130), chartHeight 250
- Light: cream/amber — page `#f3ecdf`, surface `#faf5ea`, text `#231f1a`,
  gold `#d9a227`, goldInk `#6a4e0d`, cyan (the information colour) `#14567d`;
  green and red collapse to amber/grey (`#6a4e0d`, `#59544a`) because in the
  cream world blue carries information and gold means up.

Per-variant knobs: `chartHeight` (124–250), `signAs: 'chip' | 'arrow'`,
`texture?: 'plate' | 'brushed'`, `glow?: {up, accent, blur, size, accentColor?}`.

## Type scale and spacing

- type: label 11, body 13, value 15, title 17, display 34, hero 46
- weights: 400/500/700/800/900; labels are 800 uppercase, letterSpacing 1.1
- numbers: always `tabular-nums`; hero number 46/700, letterSpacing -1.6
- space: 4/8/12/16/24/32; radius: 0/3/4/6/8 (8 is the ceiling — structure is
  expressed with rules, not rounded containers)
- App column: maxWidth 1040, hairline side borders; tab bar moves to the top
  at width >= 900

## Interaction rules (global CSS)

- Rows (`[data-row]`) hover to `--c-surface`, 120ms ease-out; hover only under
  `@media (hover: hover) and (pointer: fine)`.
- Player cards (`[data-card="player"]`) lift `translateY(-2px)` + gold border,
  140ms; no shadows anywhere — the flat world has no honest light source.
- Chart scrub markers animate cx/cy/x1/x2 110ms cubic-bezier(0.22,1,0.36,1);
  scrubbing snaps only to real settled dates.
- Focus: 2px solid `--c-focus` outline, offset 2, on every interactive role.
- `prefers-reduced-motion` collapses all animation; `prefers-reduced-transparency`
  removes ambient glow fields.

## Verification discipline

- Every text/background pair in every treatment must measure >= 4.5:1 — all
  three chrome bars carry text, so all three are contrast-checked.
- "Verified rendered, not just declared": after changing a colour, measure the
  pixel on screen (Playwright screenshot or getComputedStyle), because a CSS
  variable can be overridden by a stale seeded value or a variant fallback.
- Charts label their axes and name real dates; a control that would always
  render an empty/flat state does not ship until the data can move.
