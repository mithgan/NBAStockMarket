import { createContext } from 'react';

import type { AccessTokenProvider } from '../api/client';

export interface GameAuthUser {
  id: string;
  email?: string;
  app_metadata?: { provider?: string };
  created_at?: string;
}

export interface GameAuthSession {
  access_token: string;
  expires_at?: number;
  user: GameAuthUser;
}

export interface AuthContextValue {
  provider: 'supabase' | 'databallr';
  session: GameAuthSession | null;
  user: GameAuthUser | null;
  isLoading: boolean;
  isSubmitting: boolean;
  canSignIn: boolean;
  error: string | null;
  notice: string | null;
  signInWithDataballr: () => Promise<boolean>;
  cancelSignIn: () => void;
  signInWithGoogle: () => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearMessage: () => void;
  getAccessToken: AccessTokenProvider;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
