/**
 * A held key is one press. Holding Enter on +1 night let the browser's key
 * auto-repeat play a night every few hundred milliseconds (Day 0 to Day 8
 * in 2.5 s, walk 3 T4-15). Repeated Enter and Space keydowns on a control
 * are stopped before react-native-web turns each into a press; typing in a
 * field is left alone.
 */

const CONTROL = '[role="button"], button, [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="link"], a[href]';

let installed = false;

export function ignoreHeldKeys(): void {
  if (installed || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  installed = true;
  window.addEventListener('keydown', (event) => {
    if (!event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    const target = event.target as { closest?: (selector: string) => unknown } | null;
    if (!target?.closest?.(CONTROL)) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}
