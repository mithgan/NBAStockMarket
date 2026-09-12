import { AuthRequest, CodeChallengeMethod, ResponseType } from 'expo-auth-session';
import { getRandomBytes } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import type { AccessTokenProvider } from '../api/client';
import type { DataballrAppConfig } from '../api/config';
import { AuthContext, type AuthContextValue, type GameAuthSession } from './authTypes';
import { DataballrSessionStore } from './databallrSession';
import { completeDataballrPopup, openDataballrPopup, type DataballrPopup } from './databallrPopup';

export function DataballrAuthProvider({
  config,
  children,
}: {
  config: DataballrAppConfig;
  children: ReactNode;
}) {
  const [session, setSession] = useState<GameAuthSession | null>(null);
  const [request, setRequest] = useState<AuthRequest | null>(null);
  const [generation, setGeneration] = useState(0);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false);
  const actionVersion = useRef(0);
  const requestRef = useRef<AuthRequest | null>(null);
  const popupRef = useRef<DataballrPopup | null>(null);
  const store = useMemo(
    () =>
      new DataballrSessionStore(config.oauth, (next) => {
        if (mounted.current) setSession(next);
      }),
    [config.oauth],
  );
  const discovery = useMemo(
    () => ({
      authorizationEndpoint: config.oauth.issuer + '/oauth2/authorize',
    }),
    [config.oauth.issuer],
  );

  useEffect(() => {
    mounted.current = true;
    setSession(null);
    return () => {
      mounted.current = false;
      actionVersion.current += 1;
      store.clear();
      popupRef.current?.cancel();
      popupRef.current = null;
    };
  }, [store]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) return;
    try {
      const result = completeDataballrPopup(config.oauth.redirectUri);
      if (result === 'orphan' || result === 'invalid')
        setError('This sign-in has ended. Start a new sign-in.');
    } catch {
      setError('This sign-in window lost its connection. Return to the game and sign in again.');
    }
  }, [config.oauth.redirectUri]);

  useEffect(() => {
    let active = true;
    requestRef.current = null;
    setRequest(null);
    if (
      Platform.OS !== 'web' ||
      typeof window === 'undefined' ||
      window.location.origin + window.location.pathname !== config.oauth.redirectUri
    ) {
      setError('Open this staging preview at http://localhost:8080/ to sign in.');
      return;
    }
    try {
      const next = new AuthRequest({
        clientId: config.oauth.clientId,
        redirectUri: config.oauth.redirectUri,
        scopes: ['openid', 'profile', 'email'],
        responseType: ResponseType.Code,
        usePKCE: true,
        codeChallengeMethod: CodeChallengeMethod.S256,
        state: Array.from(getRandomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join(
          '',
        ),
        extraParams: { resource: config.oauth.audience },
      });
      void next
        .makeAuthUrlAsync(discovery)
        .then(() => {
          if (active) {
            requestRef.current = next;
            setRequest(next);
          }
        })
        .catch(() => {
          if (active) setError('Sign-in could not start. Reload the page and try again.');
        });
    } catch {
      setError('Sign-in could not start. Reload the page and try again.');
    }
    return () => {
      active = false;
    };
  }, [config.oauth, discovery, generation]);

  useEffect(() => {
    if (!session?.expires_at) return;
    const expire = () => {
      store.getAccessToken(false);
    };
    const timer = setTimeout(expire, Math.max(0, session.expires_at * 1000 - Date.now()));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') expire();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [session, store]);

  const signInWithDataballr = useCallback(async () => {
    const prepared = requestRef.current;
    if (!prepared?.codeVerifier || !prepared.url) return false;
    requestRef.current = null;
    setRequest(null);
    const version = ++actionVersion.current;
    const attempt = store.begin();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      // The request URL/PKCE were prepared earlier: open the popup directly in
      // the button's user gesture, before any await or network request.
      const popup = openDataballrPopup(prepared.url, config.oauth.redirectUri);
      popupRef.current = popup;
      const result = await popup.result;
      if (!mounted.current || actionVersion.current !== version) return false;
      if (result.type === 'cancel') {
        store.clear();
        setNotice('Sign-in was cancelled. You can try again.');
        return false;
      }
      if (result.type !== 'success')
        throw new Error('The sign-in response was not accepted. Try again.');
      return await store.complete(attempt, {
        callbackUrl: result.url,
        expectedState: prepared.state,
        codeVerifier: prepared.codeVerifier,
      });
    } catch {
      if (mounted.current && actionVersion.current === version) {
        store.clear();
        setError('Sign-in could not be completed. Please try again.');
      }
      return false;
    } finally {
      if (mounted.current && actionVersion.current === version) {
        setSubmitting(false);
        popupRef.current = null;
        // A new attempt always has a new state and verifier, including cancel.
        setGeneration((value) => value + 1);
      }
    }
  }, [config.oauth.redirectUri, store]);

  const signOut = useCallback(async () => {
    actionVersion.current += 1;
    requestRef.current = null;
    setRequest(null);
    store.clear();
    popupRef.current?.cancel();
    popupRef.current = null;
    setSubmitting(false);
    setError(null);
    setNotice('Signed out of the game. Your Databallr account stays signed in.');
    setGeneration((value) => value + 1);
  }, [store]);
  const cancelSignIn = useCallback(() => {
    actionVersion.current += 1;
    requestRef.current = null;
    setRequest(null);
    store.clear();
    popupRef.current?.cancel();
    popupRef.current = null;
    setSubmitting(false);
    setError(null);
    setNotice('Sign-in was cancelled. You can try again.');
    setGeneration((value) => value + 1);
  }, [store]);
  const getAccessToken = useCallback<AccessTokenProvider>(
    async (forceRefresh) => store.getAccessToken(Boolean(forceRefresh), session),
    [store, session],
  );
  const unavailable = useCallback(async () => {
    setError('Use Sign in with Databallr for this game.');
    return false;
  }, []);
  const clearMessage = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);
  const value = useMemo<AuthContextValue>(
    () => ({
      provider: 'databallr',
      session,
      user: session?.user ?? null,
      isLoading: false,
      isSubmitting,
      canSignIn: request !== null && !isSubmitting,
      error,
      notice,
      signInWithDataballr,
      cancelSignIn,
      signInWithGoogle: unavailable,
      signIn: unavailable,
      signUp: unavailable,
      signOut,
      clearMessage,
      getAccessToken,
    }),
    [
      session,
      isSubmitting,
      request,
      error,
      notice,
      signInWithDataballr,
      unavailable,
      signOut,
      cancelSignIn,
      clearMessage,
      getAccessToken,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
