import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '../theme';
import { useAuth } from './AuthContext';

export function AuthScreen() {
  const { clearMessage, error, isSubmitting, notice, signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submitSignIn = () => void signIn(email, password);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.mark}><Text style={styles.markText}>DB</Text></View>
        <Text style={styles.eyebrow}>NBA STOCK MARKET</Text>
        <Text accessibilityRole="header" style={styles.title}>Your portfolio, everywhere</Text>
        <Text style={styles.copy}>
          Sign in to trade players and keep one server-backed balance across devices.
        </Text>

        {error || notice ? (
          <Pressable
            accessibilityLabel={`${error ?? notice}. Dismiss message`}
            accessibilityRole="button"
            onPress={clearMessage}
            style={[styles.message, error ? styles.errorMessage : styles.noticeMessage]}
          >
            <Text style={styles.messageText}>{error ?? notice}</Text>
          </Pressable>
        ) : null}

        <View style={styles.form}>
          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!isSubmitting}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            returnKeyType="next"
            style={styles.input}
            textContentType="emailAddress"
            value={email}
          />
          <Text style={styles.label}>PASSWORD</Text>
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete="password"
            editable={!isSubmitting}
            onChangeText={setPassword}
            onSubmitEditing={submitSignIn}
            placeholder="At least 6 characters"
            placeholderTextColor={colors.muted}
            returnKeyType="go"
            secureTextEntry
            style={styles.input}
            textContentType="password"
            value={password}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isSubmitting }}
            disabled={isSubmitting}
            onPress={submitSignIn}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            {isSubmitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.primaryText}>SIGN IN</Text>}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isSubmitting }}
            disabled={isSubmitting}
            onPress={() => void signUp(email, password)}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>CREATE ACCOUNT</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', alignSelf: 'center', width: '100%', maxWidth: 480, padding: 24 },
  mark: { width: 44, height: 44, borderRadius: 7, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  markText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: '900', letterSpacing: 1.4, marginTop: 24 },
  title: { color: colors.text, fontSize: 31, lineHeight: 36, fontWeight: '900', marginTop: 6 },
  copy: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 10 },
  message: { borderWidth: 1, borderRadius: 7, padding: 12, marginTop: 18 },
  errorMessage: { borderColor: colors.red, backgroundColor: '#3b1d24' },
  noticeMessage: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  messageText: { color: colors.text, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  form: { marginTop: 24, gap: 10 },
  label: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.1, marginTop: 4 },
  input: { minHeight: 50, color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 7, paddingHorizontal: 14, fontSize: 15 },
  primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold, borderRadius: 7, marginTop: 8 },
  primaryText: { color: colors.background, fontSize: 12, fontWeight: '900' },
  secondaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderColor: colors.border, borderWidth: 1, borderRadius: 7 },
  secondaryText: { color: colors.text, fontSize: 12, fontWeight: '900' },
  pressed: { opacity: 0.68 },
});
