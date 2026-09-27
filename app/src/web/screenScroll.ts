/**
 * The page itself never scrolls (the body is fixed; each screen scrolls
 * inside its own list), so a wheel over the frame, the Market's toolbar or
 * the margins beside the app moved nothing, and Page Down, Space or the
 * arrows did nothing until a row had focus (walk 13 T2-07, T2-08). Both now
 * scroll the screen's main list, unless something under the pointer or in
 * focus takes them itself, or a dialog or sheet is open.
 */
import { reduceMotionChosen } from '../state/motionPreference';

/** Controls that use these keys themselves (a text box, the tabs, a slider, a radio row…). */
const TAKES_KEYS = [
  'a[href]', 'button', 'input', 'select', 'textarea', '[contenteditable="true"]',
  '[role="button"]', '[role="tab"]', '[role="slider"]', '[role="radio"]', '[role="switch"]',
  '[role="checkbox"]', '[role="menuitem"]', '[role="option"]', '[role="link"]',
].join(', ');

function scrollsVertically(node: Element): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  const style = getComputedStyle(node);
  return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
}

let cached: { node: HTMLElement; at: number } | null = null;

/** The screen's main list: its largest scrolling area (kept for a moment while it stays on the page). */
function mainScroller(): HTMLElement | null {
  const now = Date.now();
  if (cached && cached.node.isConnected && now - cached.at < 1500 && scrollsVertically(cached.node)) return cached.node;
  const screen = document.getElementById('app-screen');
  if (!screen) return null;
  let best: HTMLElement | null = null;
  let area = 0;
  for (const node of [screen, ...Array.from(screen.querySelectorAll('*'))]) {
    if (!scrollsVertically(node)) continue;
    const size = node.clientWidth * node.clientHeight;
    if (size > area) {
      best = node;
      area = size;
    }
  }
  cached = best ? { node: best, at: now } : null;
  return best;
}

/** A dialog, sheet or menu is open over the screen: it keeps the wheel and the keys. */
function somethingModalOpen(): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"], [role="dialog"], [role="alertdialog"], [role="menu"]'))
    .some((node) => node.getClientRects().length > 0);
}

/** Whether a scrolling area under the pointer can still move this way (it takes the wheel). */
function innerTakesWheel(target: Element | null, deltaY: number): boolean {
  for (let node = target; node && node !== document.body; node = node.parentElement) {
    if (!scrollsVertically(node)) continue;
    const room = deltaY > 0
      ? node.scrollTop + node.clientHeight < node.scrollHeight - 1
      : node.scrollTop > 0;
    if (room) return true;
  }
  return false;
}

function scrollBy(node: HTMLElement, top: number, smooth: boolean): void {
  // react-native-web gives a ScrollView's node its own scrollTo({ x, y }):
  // the element's own methods, called directly.
  (Element.prototype.scrollBy as (this: Element, options: ScrollToOptions) => void)
    .call(node, { top, behavior: smooth ? 'smooth' : 'auto' });
}

let installed = false;

/** Forward stray wheel turns and page keys to the screen's list (web only). */
export function installScreenScroll(): void {
  if (installed || typeof document === 'undefined' || typeof window === 'undefined') return;
  installed = true;

  document.addEventListener('wheel', (event) => {
    if (event.defaultPrevented || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (somethingModalOpen()) return;
    if (innerTakesWheel(event.target as Element | null, event.deltaY)) return;
    const main = mainScroller();
    if (!main) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? main.clientHeight : 1;
    scrollBy(main, event.deltaY * unit, false);
    event.preventDefault();
  }, { passive: false });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const active = document.activeElement as HTMLElement | null;
    // Only with the keyboard on nothing that uses the key: the page, the
    // screen's own landmark (where a screen switch puts focus), or text.
    const idle = !active || active === document.body || active === document.documentElement
      || active.id === 'app-screen' || !active.matches(TAKES_KEYS);
    if (!idle || somethingModalOpen()) return;
    // A focused scrolling list scrolls itself.
    if (active && active !== document.body && scrollsVertically(active) && active.id !== 'app-screen') return;
    const main = mainScroller();
    if (!main) return;
    const page = Math.round(main.clientHeight * 0.85);
    const smooth = !(reduceMotionChosen() || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    switch (event.key) {
      case 'PageDown':
        scrollBy(main, page, smooth);
        break;
      case 'PageUp':
        scrollBy(main, -page, smooth);
        break;
      case ' ':
      case 'Spacebar':
        scrollBy(main, event.shiftKey ? -page : page, smooth);
        break;
      case 'ArrowDown':
        scrollBy(main, 40, false);
        break;
      case 'ArrowUp':
        scrollBy(main, -40, false);
        break;
      case 'Home':
        scrollBy(main, -main.scrollTop, smooth);
        break;
      case 'End':
        scrollBy(main, main.scrollHeight, smooth);
        break;
      default:
        return;
    }
    event.preventDefault();
  });
}
