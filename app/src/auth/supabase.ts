import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { PublicAppConfig } from '../api/config';

let client: SupabaseClient | null = null;
let clientFingerprint: string | null = null;
let appStateListenerInstalled = false;

export function getSupabaseClient(config: PublicAppConfig): SupabaseClient {
  const fingerprint = `${config.supabaseUrl}\n${config.supabasePublishableKey}`;
  if (client && clientFingerprint === fingerprint) return client;

  client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
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
