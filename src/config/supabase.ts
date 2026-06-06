import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://aygjmtoubunzozpfxvrq.supabase.co';
// Anon key é pública (RLS protege); fallback evita APK sem env do EAS.
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5Z2ptdG91YnVuem96cGZ4dnJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NjI3MTEsImV4cCI6MjA5NTMzODcxMX0.i_AuKLz0d0ETGs3HIoFlyA9Wj2n4xI7tUBHHrjBdwl0';

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
