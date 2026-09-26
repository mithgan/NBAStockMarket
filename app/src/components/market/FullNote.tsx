/**
 * The answer to tapping FULL: an inline note under the row that says why he
 * cannot be added and offers the way forward (the Roster, where drops and
 * closes happen). Focus lands on that button; Escape or OK closes the note.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, space, type } from '../../theme';
import { Button } from '../../ui/kit';
import { canOpenRoster, openRoster } from './openRoster';

export function FullNote({
  message,
  actionLabel,
  onClose,
  style,
}: {
  message: string;
  actionLabel: string;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const go = useRef<View>(null);
  const ok = useRef<View>(null);
  const showGo = canOpenRoster();
  useEffect(() => {
    const target = (showGo ? go.current : ok.current) as unknown as { focus?: () => void } | null;
    target?.focus?.();
  }, [showGo]);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <View accessibilityRole="alert" style={[styles.note, style]}>
      <Text style={styles.text}>{message}</Text>
      <View style={styles.buttons}>
        {showGo ? <Button ref={go} label={actionLabel} onPress={() => openRoster()} variant="primary" /> : null}
        <Button ref={ok} label="OK" onPress={onClose} variant="secondary" />
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
