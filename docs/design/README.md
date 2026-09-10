# Databallr Stock Market — design documentation

This set documents the design system and the choices behind the current UI of
the NBA Stock Market app (`app/`), as it stands on `mith/experiments` after
the reconstruction and the declutter era. It is written by the UI session that
recovered the system from the deployed bundle and reviewed every design commit
since; values quoted here are the values in the code, not approximations.

| Doc | What it covers |
|---|---|
| [01-principles.md](01-principles.md) | The rules everything else follows — money is the sentence, one loud thing per screen, the colour grammar, honesty rules, verification discipline |
| [02-tokens.md](02-tokens.md) | Palette, type scale, spacing, radius, numerals, and the CSS-custom-property architecture that makes treatments cheap |
| [03-treatments.md](03-treatments.md) | The 14 design treatments, the three-step frame chrome, textures, glows, and the fallback rule |
| [04-screens.md](04-screens.md) | Screen-by-screen anatomy and the reasoning behind each surface's current shape |
| [05-interaction-motion.md](05-interaction-motion.md) | Hover, scrubbing, count-ups, breakpoints, reduced-motion and focus |
| [06-history.md](06-history.md) | The decision log: how the UI got here, including the debates and the reversals |

Companion references:

- `app/.claude/skills/printing-press/SKILL.md` — the same system packaged as a
  working skill for future Claude sessions (apply-the-style instructions).
- `vercel-mirror/` (on the reconstruction branch) — the archived original
  deployment the foundation was recovered from
  (https://mith-exp-databallr.vercel.app).

A note on provenance: the token layer (`src/theme.ts`), the treatment table
(`src/theme/variants.ts`), and the global CSS (`src/web/globalStyles.ts`) were
reconstructed 1:1 from the deployed bundle and have not needed a single change
through more than twenty subsequent design commits. The foundation is stable;
these docs treat it as settled and spend their detail on the choices built on
top of it.
