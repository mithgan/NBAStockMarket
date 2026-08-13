import { VARIANTS, type VariantId } from './variants';

/**
 * Writes a design variant into the document.
 *
 * Every colour token in theme.ts reads through `var(--c-*, fallback)`, so
 * rewriting the custom properties on the root element restyles the whole app
 * in one pass — no React re-render carries the palette. The body background
 * is painted directly so overscroll matches the variant, and the glow blur
 * rides along as `--glow-blur` for the CSS that renders Ambient's fields.
 */
export function applyVariant(id: VariantId): void {
  if (typeof document === 'undefined') return;
  const variant = VARIANTS[id];
  if (!variant) return;
  const root = document.documentElement;
  for (const [token, value] of Object.entries(variant.palette)) {
    root.style.setProperty(`--c-${token}`, value);
  }
  root.style.setProperty('--f-display', variant.fonts.display);
  root.style.setProperty('--f-body', variant.fonts.body);
  root.dataset.variant = id;
  document.body.style.backgroundColor = variant.palette.background;
  root.style.setProperty('--glow-blur', `${variant.glow?.blur ?? 64}px`);
}
