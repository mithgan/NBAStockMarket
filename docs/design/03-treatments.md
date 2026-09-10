# 03 — Treatments

Source of truth: `app/src/theme/variants.ts`. A treatment is a complete visual
world: palette, font pair, and a few layout knobs. Fourteen exist; all are
kept alive because the gallery (`/treatments`, or any URL with `?design`)
renders them side by side and regressions in one are regressions in the
system.

## Per-treatment knobs

- `palette` — full token set (see the fallback rule below)
- `fonts` — display/body pair (only Tape overrides: full monospace)
- `chartHeight` — the one honest per-treatment layout difference (124–250px)
- `signAs` — how P&L signs render: `'chip'` (filled pill) or `'arrow'`
- `texture` — optional full-screen layer: `'plate'` or `'brushed'`
- `glow` — optional ambient colour fields `{ up, accent, blur, size,
  accentColor? }`

## The frame steps (the "printing press" chrome)

The app frame is three stacked bars, each with its own token, stepping into
the page:

| Bar | Token | Light | Dark/Immersive | Base |
|---|---|---|---|---|
| Brand bar | `chrome` | `#e0cfae` | `#10141b` | `#151b24` |
| Tab bar | `chromeMid` | `#e9dcc3` | `#10141b` | `#151b24` |
| Season strip | `chromeSoft` | `#efe7d6` | `#07090d` | `#0e1218` |
| Page | `background` | `#f3ecdf` | `#07090d` | `#0e1218` |

In the cream world the steps descend lightest-at-the-bottom, so the frame
visibly sinks into the page. The standing earnings strip (TONIGHT / 7 NIGHTS)
sits on the `chromeSoft` step — it is part of the frame, not a card.

**The fallback rule** (this fixed a shipped bug): a treatment that says
nothing about its chrome gets `chrome`/`chromeMid` = its **own** `surface`
and `chromeSoft` = its **own** `background` — never the base palette's.
Before the rule, every dark treatment's brand bar silently fell back to base
navy. The constructor in `variants.ts` enforces it; do not build a palette by
object-spread around it.

## The fourteen

Picker order: Flat, OG, Immersive, Monochrome, Ambient, Haze, Aurora, Tape,
Slab, Anvil, Brushed, Default (grain), Dark, Light. Default id: **`grain`**.
Settings' appearance shortlist: `grain`, `dark`, `nocturne` (Aurora), `light`.

| Treatment (id) | bg / surface | Character | Knobs |
|---|---|---|---|
| Flat (`default`) | `#0e1218` / `#151b24` | The navy, untextured | chart 168, chip |
| OG (`og`) | `#1b212c` / `#232a39` | Ryan's original palette, softer surfaces | chart 124, arrow |
| Immersive | `#07090d` / `#10141b` | Near-black, chart-led | chart 250, arrow |
| Monochrome | `#0f1114` / `#161920` | No green/red: gold = up (`#ffcd57`), grey = down (`#9aa1ab`) | chart 168, arrow |
| Ambient | `#0a0d14` / `#141926` | Blurred colour fields behind content | glow .17/.10, blur 64, size 340 |
| Haze | `#0c0f16` / `#161b27` | Ambient, volume down; mint `#93d9b8` / rose `#f0a9ae` | glow .10/.07, blur 104, size 440 |
| Aurora (`nocturne`) | `#161d2b` / `#1f2736` | Plates under a warm light; accent `#e8833a` | chart 250, plate + glow blur 130/480 |
| Tape | `#0c0d10` / `#15171c` | Ticker tape: monospace everything, hard divisions | chart 150, arrow, mono fonts |
| Slab | `#111214` / `#191b1f` | Machined plates, lit along the top edge | chart 168, chip, plate |
| Anvil | `#131211` / `#1c1a17` | Slab in browner metal | chip, plate |
| Brushed | `#0f1214` / `#171c20` | Brushed steel: milled grain + raking light | arrow, brushed |
| Default (`grain`) | base navy | The navy under the milled grain — **the shipped look** | arrow, brushed |
| Dark | `#07090d` / `#10141b` | The grain pushed near-black | arrow, brushed |
| Light | `#f3ecdf` / `#faf5ea` | Cream and amber, almost monochrome; blue carries information | chip |

Light's full remapping is the deepest: text `#231f1a`, gold `#d9a227`,
goldInk `#6a4e0d`, cyan `#14567d`, and green/red collapse to amber/grey
(`#6a4e0d` / `#59544a`) — in the cream world gold means up and blue means
information, because saturated green/red on cream read as toy candy.

## Textures and glows (CSS, not components)

Textures and blur are not React Native styles, so they reach CSS through
`nativeID` hooks defined in `web/globalStyles.ts`:

- **Brushed** (`#variant-texture-brushed`): a 3px repeating vertical grain
  (`rgba(255,255,255,0.021)`) crossed by a raking light
  (168° gradient, 0.07 → transparent). Both are held near the threshold of
  visibility on purpose — this sits under live numbers, and a texture a
  reader can resolve is a texture competing with them.
- **Plate** (`#variant-texture-plate`): a single top-edge light
  (0.055 → transparent over 200px), the "machined slab" read.
- **Ambient fields** (`#ambient-field-up`, `#ambient-field-accent`): two
  positioned colour blobs (green + gold/accent) blurred by
  `--glow-blur`; hidden entirely under `prefers-reduced-transparency`.

## Working on treatments

1. Never read a hex from a screenshot — read `variants.ts`.
2. Any new text/background pairing must measure ≥ 4.5:1 in **every**
   treatment, including all three chrome bars (they all carry text).
3. Check Dark *and* Light after any chrome or token change: Dark catches
   fallback bugs, Light catches ink/paint confusion.
4. The gallery at `?design=1` is the review surface; a treatment change that
   was not looked at there was not reviewed.
