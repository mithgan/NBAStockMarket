import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { holdShift } from '../../data/rosterView';

interface Held {
  key: string;
  /** The row's top on screen, and the list's scroll, when last looked at. */
  top: number;
  scrollTop: number;
  scroller: HTMLElement;
  /** The list's own overflow-anchor, given back on release. */
  anchorWas: string;
  /**
   * Kept through taps and focus elsewhere, until `release()`: an open Drop or
   * Close question while +1 night plays (walk 14 T4-05).
   */
  throughTaps: boolean;
  /** Looks again whenever the list's content changes size (a chart a child draws on its own render). */
  observer: ResizeObserver | null;
}

/** The nearest box around `node` that scrolls up and down. */
function scrollerOf(node: HTMLElement): HTMLElement | null {
  let area = node.parentElement;
  while (area && !(area.scrollHeight > area.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(area).overflowY))) {
    area = area.parentElement;
  }
  return area;
}

/**
 * Keeps a row you just opened where it is on screen while the lists above it
 * change: a night landing, a move that waited for it (walk 12, fix 12 check:
 * a queued drop landing moved an opened Closed row 103px under the finger,
 * 87px of it the browser's own scroll anchoring on the row that left). The
 * hold ends with the next tap or focus anywhere else, when the row folds or
 * leaves, and it never moves a list whose row is off screen. Web only.
 *
 * `rowRef(key)` goes on each row's outer view; `hold(key)` right after a row
 * opens, `release()` when it folds. Call the hook where the rows render: it
 * looks again after every render of that component. `hold(key, { throughTaps:
 * true })` keeps an open Drop or Close question in view while +1 night (a tap
 * elsewhere) draws the chart and the tip above it, until it is answered
 * (walk 14 T4-05); a scroll of yours still wins.
 */
export function useHoldInView() {
  const nodes = useRef(new Map<string, HTMLElement>());
  const held = useRef<Held | null>(null);

  const release = useCallback(() => {
    const current = held.current;
    held.current = null;
    if (!current) return;
    current.observer?.disconnect();
    current.scroller.style.setProperty('overflow-anchor', current.anchorWas);
  }, []);

  const look = useCallback((current: Held) => {
    const node = nodes.current.get(current.key);
    if (!node) return;
    current.top = node.getBoundingClientRect().top;
    current.scrollTop = current.scroller.scrollTop;
  }, []);

  // Content above the held row moved it: the list scrolls by as much and the
  // row stays under the finger.
  const settle = useCallback(() => {
    const current = held.current;
    if (!current) return;
    const node = nodes.current.get(current.key);
    if (!node || !node.isConnected) {
      release();
      return;
    }
    const { scroller } = current;
    const rect = node.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const shift = holdShift({
      top: rect.top,
      previousTop: current.top,
      height: rect.height,
      viewTop: view.top,
      viewBottom: view.bottom,
      // A scroll since the last look is yours (or keyboard focus's): kept.
      scrolled: Math.abs(scroller.scrollTop - current.scrollTop) >= 1,
    });
    if (shift !== 0) scroller.scrollTop += shift;
    look(current);
  }, [look, release]);

  const hold = useCallback((key: string, { throughTaps = false }: { throughTaps?: boolean } = {}) => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    release();
    const node = nodes.current.get(key);
    const scroller = node ? scrollerOf(node) : null;
    if (!node || !scroller) return;
    const anchorWas = scroller.style.getPropertyValue('overflow-anchor');
    // The browser's own guess at what to keep still would fight this one.
    scroller.style.setProperty('overflow-anchor', 'none');
    // A question held through a night: the chart and the tip above it are
    // drawn by their own renders, so the list's size is watched too.
    const content = throughTaps && typeof ResizeObserver !== 'undefined' ? scroller.firstElementChild : null;
    const observer = content ? new ResizeObserver(() => settle()) : null;
    held.current = { key, top: 0, scrollTop: 0, scroller, anchorWas, throughTaps, observer };
    look(held.current);
    if (observer && content) observer.observe(content);
  }, [look, release, settle]);

  // After every render of the component that holds the rows.
  useLayoutEffect(() => {
    settle();
  });

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const elsewhere = (event: Event) => {
      const current = held.current;
      if (!current || current.throughTaps) return;
      const node = nodes.current.get(current.key);
      if (!node || !(event.target instanceof Node) || !node.contains(event.target)) release();
    };
    const scrolled = () => {
      if (held.current) look(held.current);
    };
    document.addEventListener('pointerdown', elsewhere, true);
    document.addEventListener('focusin', elsewhere, true);
    document.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('pointerdown', elsewhere, true);
      document.removeEventListener('focusin', elsewhere, true);
      document.removeEventListener('scroll', scrolled, true);
      release();
    };
  }, [look, release]);

  const rowRef = useCallback((key: string) => (node: unknown) => {
    if (node) nodes.current.set(key, node as HTMLElement);
    else nodes.current.delete(key);
  }, []);

  return { hold, release, rowRef, heldKey: () => held.current?.key ?? null };
}
