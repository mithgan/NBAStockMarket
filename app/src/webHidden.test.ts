import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * accessibilityElementsHidden (iOS) and importantForAccessibility (Android) do
 * nothing on the web: a drawn duplicate or an icon beside its own words was
 * read as an unnamed image there (walk 11 T3-06). Every element hidden that
 * way also carries aria-hidden.
 */
const root = resolve(__dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** The JSX opening tag around `at`, braces balanced. */
function tagAround(source: string, at: number): string {
  const start = source.lastIndexOf('<', at);
  let depth = 0;
  for (let i = at; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (char === '>' && depth === 0 && source[i - 1] !== '=') return source.slice(start, i + 1);
  }
  return source.slice(start);
}

test('an element hidden from native screen readers is hidden on the web too (walk 11 T3-06)', () => {
  const missing: string[] = [];
  for (const file of [...tsxFiles(join(root, 'src')), join(root, 'App.tsx')]) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/accessibilityElementsHidden(?!=\{)/g)) {
      const tag = tagAround(source, match.index ?? 0);
      if (!tag.includes('aria-hidden')) {
        missing.push(`${relative(root, file)}:${source.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
