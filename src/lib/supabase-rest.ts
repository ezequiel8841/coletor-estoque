import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config/supabase';
import { httpGet, httpPost, httpPostBinary } from './http-post';

const USER_ID_STORAGE_KEY = 'coletor_user_id';
const ACCESS_TOKEN_STORAGE_KEY = 'coletor_access_token';
const TOKEN_EXPIRES_STORAGE_KEY = 'coletor_token_expires_at';

let cachedToken: string | null = null;
let cachedExpiresAt = 0;
let cachedUserId: string | null = null;
let sessionRefreshPromise: Promise<string> | null = null;

function supabaseAuthStorageKey(): string {
  const host = new URL(SUPABASE_URL).hostname;
  return `sb-${host.split('.')[0]}-auth-token`;
}

type StoredSession = {
  access_token: string;
  expires_at?: number;
  user?: { id?: string };
};

function isTokenValid(): boolean {
  if (!cachedToken) return false;
  if (!cachedExpiresAt) return true;
  return cachedExpiresAt * 1000 > Date.now() + 60_000;
}

async function readSupabaseSessionFromStorage(): Promise<StoredSession | null> {
  const raw = await AsyncStorage.getItem(supabaseAuthStorageKey());
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const session = (parsed.access_token ? parsed : parsed.currentSession ?? parsed.session) as StoredSession | null;
    if (session?.access_token) return session;
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

/** Define token em memória + AsyncStorage (chamar no login / restore de sessão). */
export function setAccessTokenCache(token: string, expiresAt = 0): void {
  cachedToken = token;
  cachedExpiresAt = expiresAt;
  void AsyncStorage.multiSet([
    [ACCESS_TOKEN_STORAGE_KEY, token],
    [TOKEN_EXPIRES_STORAGE_KEY, String(expiresAt)],
  ]);
}

export function setUserIdCache(userId: string): void {
  cachedUserId = userId;
  void AsyncStorage.setItem(USER_ID_STORAGE_KEY, userId);
}

export function getUserIdCache(): string | null {
  return cachedUserId;
}

export async function loadUserIdFromStorage(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  const stored = await AsyncStorage.getItem(USER_ID_STORAGE_KEY);
  if (stored) cachedUserId = stored;
  return stored;
}

export function clearAccessTokenCache(): void {
  cachedToken = null;
  cachedExpiresAt = 0;
  cachedUserId = null;
  sessionRefreshPromise = null;
  void AsyncStorage.multiRemove([
    USER_ID_STORAGE_KEY,
    ACCESS_TOKEN_STORAGE_KEY,
    TOKEN_EXPIRES_STORAGE_KEY,
  ]);
}

/** Restaura sessão lendo AsyncStorage — evita getSession() que trava no Android. */
export async function restoreSessionFromStorage(): Promise<{ signedIn: boolean }> {
  const [token, expiresRaw] = await AsyncStorage.multiGet([
    ACCESS_TOKEN_STORAGE_KEY,
    TOKEN_EXPIRES_STORAGE_KEY,
  ]);
  if (token[1]) {
    const expiresAt = expiresRaw[1] ? parseInt(expiresRaw[1], 10) : 0;
    setAccessTokenCache(token[1], expiresAt);
    return { signedIn: true };
  }

  const session = await readSupabaseSessionFromStorage();
  if (session?.access_token) {
    setAccessTokenCache(session.access_token, session.expires_at ?? 0);
    if (session.user?.id) setUserIdCache(session.user.id);
    return { signedIn: true };
  }

  return { signedIn: false };
}

/** Obtém token — só memória/AsyncStorage, nunca getSession (trava no Android). */
export async function ensureAccessToken(): Promise<string> {
  if (isTokenValid() && cachedToken) return cachedToken;
  if (cachedToken) return cachedToken;

  if (!sessionRefreshPromise) {
    sessionRefreshPromise = (async () => {
      const [tokenEntry, expiresEntry] = await AsyncStorage.multiGet([
        ACCESS_TOKEN_STORAGE_KEY,
        TOKEN_EXPIRES_STORAGE_KEY,
      ]);
      if (tokenEntry[1]) {
        const expiresAt = expiresEntry[1] ? parseInt(expiresEntry[1], 10) : 0;
        setAccessTokenCache(tokenEntry[1], expiresAt);
        return tokenEntry[1];
      }

      const session = await readSupabaseSessionFromStorage();
      if (session?.access_token) {
        setAccessTokenCache(session.access_token, session.expires_at ?? 0);
        if (session.user?.id) setUserIdCache(session.user.id);
        return session.access_token;
      }

      throw new Error('Sessão expirada. Faça login novamente.');
    })().finally(() => {
      sessionRefreshPromise = null;
    });
  }

  return sessionRefreshPromise;
}

/** Pré-carrega / renova token antes de operações online. */
export async function prefetchAccessToken(): Promise<void> {
  await ensureAccessToken();
}

function parseRestResponse<T>(status: number, text: string): T {
  if (status < 200 || status >= 300) {
    let msg = `Erro HTTP ${status}`;
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
}

/** GET REST autenticado — XHR (fetch trava no Android + Supabase). */
export async function supabaseRest<T>(
  path: string,
  init: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? 30_000;
  const token = await ensureAccessToken();

  const { status, text } = await httpGet(`${SUPABASE_URL}${path}`, {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(init.headers ?? {}),
  }, timeoutMs);

  return parseRestResponse<T>(status, text);
}

function parseRpcResponse<T>(status: number, text: string): T {
  if (status < 200 || status >= 300) {
    let msg = `Erro HTTP ${status}`;
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
}

/** RPC autenticado — XHR POST (fetch POST trava no Android + Supabase). */
export async function rpcCall<T>(fn: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
  const token = await ensureAccessToken();
  const { status, text } = await httpPost(
    `${SUPABASE_URL}/rest/v1/rpc/${fn}`,
    {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    JSON.stringify(args),
    timeoutMs,
  );
  return parseRpcResponse<T>(status, text);
}

/** RPC público — só anon key, sem JWT (coletor offline sync). */
export async function rpcCallPublic<T>(
  fn: string,
  args: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  const { status, text } = await httpPost(
    `${SUPABASE_URL}/rest/v1/rpc/${fn}`,
    {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    JSON.stringify(args),
    timeoutMs,
  );
  return parseRpcResponse<T>(status, text);
}

/** ID do usuário — só cache/local, nunca getSession (trava no Android). */
export async function ensureUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const stored = await loadUserIdFromStorage();
  if (stored) return stored;
  throw new Error('Usuário não identificado. Saia e entre novamente.');
}

/** Upload de arquivo para Storage via anon key (coletor). */
export async function uploadStoragePublic(
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
  timeoutMs = 60_000,
): Promise<void> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const { status, text } = await httpPostBinary(
    `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`,
    {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    bytes,
    timeoutMs,
  );

  if (status < 200 || status >= 300) {
    let msg = `Falha no upload da imagem: HTTP ${status}`;
    if (text) {
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        msg = `Falha no upload da imagem: ${parsed.message ?? parsed.error ?? msg}`;
      } catch {
        msg = `Falha no upload da imagem: ${text.slice(0, 200)}`;
      }
    }
    throw new Error(msg);
  }
}

export function getStoragePublicUrl(bucket: string, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodedPath}`;
}

/** Contagem exata via header Content-Range (PostgREST). */
export async function supabaseRestCount(path: string, timeoutMs = 15_000): Promise<number> {
  const token = await ensureAccessToken();

  const { status, getHeader } = await httpGet(`${SUPABASE_URL}${path}`, {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    Prefer: 'count=exact',
    Range: '0-0',
  }, timeoutMs);

  if (status < 200 || status >= 300) {
    throw new Error(`Erro HTTP ${status} ao contar registros.`);
  }

  const contentRange = getHeader('content-range') ?? '';
  const match = /\/(\d+)$/.exec(contentRange);
  return match ? parseInt(match[1], 10) : 0;
}
