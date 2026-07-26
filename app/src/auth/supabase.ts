import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { PublicAppConfig } from '../api/config';
import { oauthCallbackErrorFromUrl } from './authMessages';

let client: SupabaseClient | null = null;
let clientFingerprint: string | null = null;
let appStateListenerInstalled = false;
let pendingOAuthCallbackError: string | null = null;

export function getSupabaseClient(config: PublicAppConfig): SupabaseClient {
  const fingerprint = `${config.supabaseUrl}\n${config.supabasePublishableKey}`;
  if (client && clientFingerprint === fingerprint) return client;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const callbackError = oauthCallbackErrorFromUrl(window.location.href);
    if (callbackError) {
      pendingOAuthCallbackError = callbackError.message;
      window.history.replaceState(window.history.state, document.title, callbackError.cleanUrl);
    }
  }

  client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
      lock: processLock,
    },
  });
  clientFingerprint = fingerprint;

  if (Platform.OS !== 'web' && !appStateListenerInstalled) {
    appStateListenerInstalled = true;
    AppState.addEventListener('change', (state) => {
      if (!client) return;
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
  }

  return client;
}

export function takeOAuthCallbackError(): string | null {
  const message = pendingOAuthCallbackError;
  pendingOAuthCallbackError = null;
  return message;
}
