import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { AccessTokenProvider } from '../api/client';
import type { PublicAppConfig } from '../api/config';
import { authErrorMessage } from './authMessages';
import { getSupabaseClient, takeOAuthCallbackError } from './supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isSubmitting: boolean;
  error: string | null;
  notice: string | null;
  signInWithGoogle: () => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearMessage: () => void;
  getAccessToken: AccessTokenProvider;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizedCredentials(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return { credentials: null, error: 'Enter a valid email address.' };
  }
  if (password.length < 6) {
    return { credentials: null, error: 'Password must be at least 6 characters.' };
  }
  return { credentials: { email: normalizedEmail, password }, error: null };
}

export function AuthProvider({ config, children }: { config: PublicAppConfig; children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseClient(config), [config]);
  const oauthCallbackError = useRef<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const authEventVersion = useRef(0);

  useEffect(() => {
    let active = true;
    if (oauthCallbackError.current === null) {
      oauthCallbackError.current = takeOAuthCallbackError();
    }
    if (oauthCallbackError.current) setError(oauthCallbackError.current);
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventVersion.current += 1;
      if (!active) return;
      setSession(nextSession);
      setIsLoading(false);
    });
    const versionAtStart = authEventVersion.current;
    void supabase.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (!active || authEventVersion.current !== versionAtStart) return;
        setSession(data.session);
        setError(
          sessionError
            ? 'Your saved session could not be restored. Sign in again.'
            : oauthCallbackError.current,
        );
        setIsLoading(false);
      })
      .catch(() => {
        if (!active || authEventVersion.current !== versionAtStart) return;
        setSession(null);
        setError('Your saved session could not be restored. Sign in again.');
        setIsLoading(false);
      });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  const signIn = useCallback(async (email: string, password: string) => {
    const parsed = normalizedCredentials(email, password);
    if (!parsed.credentials) {
      setError(parsed.error);
      return false;
    }
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword(parsed.credentials);
      if (signInError) {
        setError(authErrorMessage(signInError.message, 'Sign in failed.'));
        return false;
      }
      return true;
    } catch {
      setError('Sign in could not reach the authentication service. Try again.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [supabase]);

  const signInWithGoogle = useCallback(async () => {
    if (typeof window === 'undefined') {
      setError('Google sign-in is available in the web test build.');
      return false;
    }
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (oauthError) {
        setError(authErrorMessage(oauthError.message, 'Google sign-in failed.'));
        return false;
      }
      return true;
    } catch {
      setError('Google sign-in could not reach the authentication service. Try again.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [supabase]);

  const signUp = useCallback(async (email: string, password: string) => {
    const parsed = normalizedCredentials(email, password);
    if (!parsed.credentials) {
      setError(parsed.error);
      return false;
    }
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp(parsed.credentials);
      if (signUpError) {
        setError(authErrorMessage(signUpError.message, 'Account creation failed.'));
        return false;
      }
      if (!data.session) {
        setNotice('Check your email to confirm the account, then sign in.');
      }
      return true;
    } catch {
      setError('Account creation could not reach the authentication service. Try again.');
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [supabase]);

  const signOut = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) setError(authErrorMessage(signOutError.message, 'Sign out failed.'));
    } catch {
      setError('Sign out could not reach the authentication service. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [supabase]);

  const clearMessage = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const getAccessToken = useCallback<AccessTokenProvider>(async (forceRefresh) => {
    try {
      if (forceRefresh) {
        const { data, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) return null;
        return data.session ? {
          accessToken: data.session.access_token,
          userId: data.session.user.id,
        } : null;
      }
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) return null;
      return data.session ? {
        accessToken: data.session.access_token,
        userId: data.session.user.id,
      } : null;
    } catch {
      return null;
    }
  }, [supabase]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    isLoading,
    isSubmitting,
    error,
    notice,
    signInWithGoogle,
    signIn,
    signUp,
    signOut,
    clearMessage,
    getAccessToken,
  }), [
    clearMessage,
    error,
    getAccessToken,
    isLoading,
    isSubmitting,
    notice,
    session,
    signIn,
    signInWithGoogle,
    signOut,
    signUp,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

/**
 * The app shell renders with no AuthProvider mounted (local demo mode, or a
 * broken public config), so components that merely adapt to auth state read it
 * through this and treat null as "no server account in play".
 */
export function useOptionalAuth() {
  return useContext(AuthContext);
}
