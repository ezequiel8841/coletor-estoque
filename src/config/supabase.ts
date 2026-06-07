import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://aygjmtoubunzozpfxvrq.supabase.co';

/** Chave anon válida — deve bater com o project ref da URL. */
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5Z2ptdG91YnVuem96cGZ4dnJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NjI3MTEsImV4cCI6MjA5NTMzODcxMX0.i_AuKLz0d0ETGs3HIoFlyA9Wj2n4xI7tUBHHrjBdwl0';

function projectRefFromUrl(url: string): string | null {
  const m = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return m?.[1] ?? null;
}

function projectRefFromJwt(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return null;
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.ref === 'string' ? json.ref : null;
  } catch {
    return null;
  }
}

function resolveAnonKey(): string {
  const fromEnv = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const urlRef = projectRefFromUrl(SUPABASE_URL);
  if (fromEnv) {
    const keyRef = projectRefFromJwt(fromEnv);
    if (urlRef && keyRef && urlRef !== keyRef) {
      console.warn(
        `[Supabase] EXPO_PUBLIC_SUPABASE_ANON_KEY ref (${keyRef}) ≠ URL (${urlRef}). Usando fallback.`,
      );
      return FALLBACK_ANON_KEY;
    }
    return fromEnv;
  }
  return FALLBACK_ANON_KEY;
}

const SUPABASE_ANON_KEY = resolveAnonKey();

export { SUPABASE_URL, SUPABASE_ANON_KEY };

if (!SUPABASE_ANON_KEY) {
  console.warn(
    '[Supabase] EXPO_PUBLIC_SUPABASE_ANON_KEY ausente. Configure o .env ou os secrets do EAS antes de usar o app.',
  );
}

// Cliente Supabase com sessão persistida em AsyncStorage (mantém login entre execuções).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
