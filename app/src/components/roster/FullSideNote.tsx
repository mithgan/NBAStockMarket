/**
 * The answer to a tap on "Add again" (or "Short again") while that side is
 * full, under the Closed row: why, naming him, and the way to make room, as
 * the Market's FULL note gives it (walk 8 T4-12). "Choose who to drop" is a
 * way forward, not a cost, so it is the primary button, never the red of a
 * drop. Focus lands on it; Escape, Back or OK closes the note, as a roster
 * row's question folds.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, space, type } from '../../theme';
import { Button } from '../../ui/kit';
import { useBackFolds } from '../../web/appHistory';

export function FullSideNote({ message, actionLabel, onAction, onClose }: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  onClose: () => void;
}) {
  const go = useRef<View>(null);
  const note = useRef<View>(null);
  useBackFolds(true, onClose);
  useEffect(() => {
    const target = go.current as unknown as { focus?: () => void; scrollIntoView?: (options?: object) => void } | null;
    target?.scrollIntoView?.({ block: 'nearest' });
    target?.focus?.();
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    // Escape closes this note only (the kit's ConfirmStrip rule): a sheet
    // open over the page takes it first, and its keyup is swallowed so
    // nothing behind the note reacts to the same press.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const node = note.current as unknown as HTMLElement | null;
      if (node?.closest?.('[inert]')) return;
      event.stopPropagation();
      const swallow = (up: KeyboardEvent) => {
        if (up.key !== 'Escape') return;
        up.stopPropagation();
        window.removeEventListener('keyup', swallow, true);
      };
      window.addEventListener('keyup', swallow, true);
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <View ref={note} accessibilityRole="alert" style={styles.note}>
      <Text style={styles.text}>{message}</Text>
      <View style={styles.buttons}>
        <Button ref={go} label={actionLabel} onPress={onAction} variant="primary" />
        <Button label="OK" onPress={onClose} variant="secondary" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
  },
  text: {
    color: colors.text,
    fontSize: type.body,
    lineHeight: 19,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});
