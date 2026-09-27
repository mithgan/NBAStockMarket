/**
 * Clamp text to a number of lines at a word boundary, ending on "…" (walk 18
 * T3-11: the browser's line clamp cut "Oct 21–Apr 12" to "Oct 21–Apr 1…",
 * which read as April 1). Words are split at ordinary spaces only, so a date
 * held together with no-break spaces and word joiners (keepDatesTogether) is
 * kept whole or left out whole.
 */

/** The words a clamp may cut between: ordinary spaces only. */
export function clampWords(text: string): string[] {
  return text.split(' ').filter((word) => word.length > 0);
}

/**
 * The longest start of `words` that `fits` with "…" after it, found by
 * halving; null when the whole text fits (no clamp needed).
 */
export function wordClampText(words: string[], fits: (text: string) => boolean): string | null {
  if (words.length === 0 || fits(words.join(' '))) return null;
  let low = 0;
  let high = words.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(`${words.slice(0, mid).join(' ')}…`)) low = mid;
    else high = mid - 1;
  }
  // A sentence's full stop or a comma before the cut reads better without it.
  const head = words.slice(0, Math.max(1, low)).join(' ').replace(/[.,:;]$/, '');
  return `${head}…`;
}

/**
 * Measure `text` as `node` would draw it in `lines` lines (web only): a
 * hidden copy with the node's font and width, never clamped. Returns the
 * word-boundary clamp, or null when the whole text fits.
 */
export function measuredWordClamp(node: HTMLElement, text: string, lines: number): string | null {
  if (typeof document === 'undefined' || !node.parentElement || node.clientWidth === 0) return null;
  const style = getComputedStyle(node);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, {
    position: 'absolute',
    visibility: 'hidden',
    pointerEvents: 'none',
    left: '0',
    top: '0',
    width: `${node.clientWidth}px`,
    font: style.font,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    lineHeight: style.lineHeight,
    whiteSpace: 'normal',
    overflowWrap: style.overflowWrap,
    textTransform: style.textTransform,
  });
  node.parentElement.appendChild(probe);
  try {
    const fits = (candidate: string) => {
      probe.textContent = candidate;
      return probe.scrollHeight <= lineHeight * lines + 1;
    };
    return wordClampText(clampWords(text), fits);
  } finally {
    probe.remove();
  }
}
