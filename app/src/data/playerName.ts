const NAME_SUFFIXES = new Set(['jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv', 'v']);

/** Broadcast lower-third split: quiet given name over the loud surname. */
export function splitPlayerName(name: string): { given: string; surname: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { given: '', surname: name };
  let index = parts.length - 1;
  if (parts.length >= 3 && NAME_SUFFIXES.has(parts[index].toLowerCase())) index -= 1;
  return { given: parts.slice(0, index).join(' '), surname: parts.slice(index).join(' ') };
}
