import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config/supabase';

const SESSION_TIMEOUT_MS = 8_000;
const AUTH_STORAGE_KEY = 'sb-aygjmtoubunzozpfxvrq-auth-token';

type StoredSession = {
  access_token?: string;
  expires_at?: number;
};

async function readTokenFromStorage(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.access_token ?? null;
  } catch {
    return null;
  }
}

async function getAccessToken(): Promise<string> {
  const stored = await readTokenFromStorage();
  if (stored) return stored;

  // Fallback: supabase auth (pode travar no Android — timeout curto)
  const { supabase } = await import('../config/supabase');
  const sessionPromise = supabase.auth.getSession();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Sessão indisponível. Faça login novamente.')), SESSION_TIMEOUT_MS);
  });
  const { data, error } = await Promise.race([sessionPromise, timeout]);
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');
  return token;
}

/** Fetch REST do Supabase com timeout real (evita hang do supabase-js no Android). */
export async function supabaseRest<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? 15_000;
  const token = await getAccessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = `Erro HTTP ${res.status}`;
      if (text) {
        try {
          const parsed = JSON.parse(text) as { message?: string; error?: string };
          msg = parsed.message ?? parsed.error ?? msg;
        } catch {
          msg = text.slice(0, 200);
        }
      }
      throw new Error(msg);
    }
    if (!text || text === 'null') return null as T;
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Tempo esgotado ao buscar produto. Verifique a conexão.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function rpcCall<T>(fn: string, args: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  return supabaseRest<T>(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args),
    timeoutMs,
  });
}

export async function tableQuery<T>(table: string, query: string, timeoutMs = 15_000): Promise<T> {
  return supabaseRest<T>(`/rest/v1/${table}?${query}`, { method: 'GET', timeoutMs });
}
