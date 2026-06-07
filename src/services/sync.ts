// ============================================================================
// Sincronização offline-first — catálogo + fila de coletas.
// ============================================================================
import { AppState, type AppStateStatus } from 'react-native';
import { ensureUserId, rpcCallPublic, supabaseRest, supabaseRestCount } from '../lib/supabase-rest';
import {
  getSyncMeta,
  listarColetasParaSync,
  marcarColetaFalha,
  marcarColetaSincronizada,
  marcarColetaSyncing,
  liberarColetasTravadas,
  preencherUsuarioIdPendentes,
  replaceCatalog,
  updateSyncMeta,
  upsertProdutos,
  replaceSeriaisCache,
} from './local-db';
import type { Inventario } from './collector';
import { registrarAvariaCloud } from './avaria-cloud';

const SAVE_TIMEOUT_MS = 30_000;

const PAGE_SIZE = 1000;
const CATALOG_SYNC_INTERVAL_MS = 60_000;
const QUEUE_SYNC_INTERVAL_MS = 15_000;

type ItemInventarioRow = {
  id: string;
  codigo_produto: string;
  nome_produto: string;
  codigo_barras_principal: string | null;
  codigo_barras_2: string | null;
  codigo_barras_3: string | null;
  atualizado_em: string | null;
  modo_contagem: string | null;
};

type SerialRow = {
  id: string;
  item_id: string;
  numero_serie: string;
  coletado: boolean;
};

let activeInventarioId: string | null = null;
let catalogTimer: ReturnType<typeof setInterval> | null = null;
let queueTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let syncingCatalog = false;
let syncingQueue = false;

function buildItemsPath(inventarioId: string, offset: number, since?: string | null): string {
  const select = 'id,codigo_produto,nome_produto,codigo_barras_principal,codigo_barras_2,codigo_barras_3,atualizado_em,modo_contagem';
  const base = `/rest/v1/itens_inventario?inventario_id=eq.${inventarioId}&select=${select}&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
  if (since) {
    return `${base}&atualizado_em=gt.${encodeURIComponent(since)}`;
  }
  return base;
}

async function fetchSerialsPage(inventarioId: string, offset: number): Promise<SerialRow[]> {
  const select = 'id,item_id,numero_serie,coletado';
  const path = `/rest/v1/itens_inventario_seriais?inventario_id=eq.${inventarioId}&select=${select}&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
  const data = await supabaseRest<SerialRow[]>(path, { timeoutMs: 30_000 });
  return data ?? [];
}

async function downloadSerialsIfNeeded(inventarioId: string, items: ItemInventarioRow[]): Promise<void> {
  const hasSerialItems = items.some((i) => i.modo_contagem === 'numero_serie');
  if (!hasSerialItems) {
    await replaceSeriaisCache(inventarioId, []);
    return;
  }
  const all: SerialRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchSerialsPage(inventarioId, offset);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  await replaceSeriaisCache(inventarioId, all);
}

async function fetchItemsPage(
  inventarioId: string,
  offset: number,
  since?: string | null,
): Promise<ItemInventarioRow[]> {
  const path = buildItemsPath(inventarioId, offset, since);
  const data = await supabaseRest<ItemInventarioRow[]>(path, { timeoutMs: 30_000 });
  return data ?? [];
}

async function fetchCatalogItemCount(inventarioId: string): Promise<number> {
  return supabaseRestCount(
    `/rest/v1/itens_inventario?inventario_id=eq.${inventarioId}&select=id`,
    15_000,
  );
}

export type CatalogDownloadProgress = {
  phase: 'preparing' | 'downloading' | 'saving';
  downloaded: number;
  total: number;
  percent: number;
};

function emitProgress(
  onProgress: ((p: CatalogDownloadProgress) => void) | undefined,
  progress: CatalogDownloadProgress,
): void {
  onProgress?.(progress);
}

/** Download completo do catálogo de produtos do inventário. */
export async function downloadCatalog(
  inventarioId: string,
  onProgress?: (progress: CatalogDownloadProgress) => void,
): Promise<number> {
  emitProgress(onProgress, { phase: 'preparing', downloaded: 0, total: 0, percent: 0 });

  const total = await fetchCatalogItemCount(inventarioId);
  emitProgress(onProgress, { phase: 'downloading', downloaded: 0, total, percent: total > 0 ? 1 : 0 });

  const all: ItemInventarioRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchItemsPage(inventarioId, offset);
    all.push(...page);
    const downloaded = all.length;
    const percent = total > 0
      ? Math.min(90, Math.round(5 + (downloaded / total) * 85))
      : Math.min(90, downloaded > 0 ? 45 : 5);
    emitProgress(onProgress, { phase: 'downloading', downloaded, total: total || downloaded, percent });
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  emitProgress(onProgress, {
    phase: 'saving',
    downloaded: all.length,
    total: total || all.length,
    percent: 95,
  });
  await replaceCatalog(inventarioId, all);
  await downloadSerialsIfNeeded(inventarioId, all);
  emitProgress(onProgress, {
    phase: 'saving',
    downloaded: all.length,
    total: total || all.length,
    percent: 100,
  });
  return all.length;
}

/** Busca incremental — produtos novos/atualizados desde last_synced_at. */
export async function syncCatalogIncremental(inventarioId: string): Promise<number> {
  const meta = await getSyncMeta(inventarioId);
  const since = meta?.last_synced_at;
  if (!since) return downloadCatalog(inventarioId);

  const all: ItemInventarioRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchItemsPage(inventarioId, offset, since);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  if (all.length > 0) {
    await upsertProdutos(inventarioId, all);
    await downloadSerialsIfNeeded(inventarioId, all);
  }
  await updateSyncMeta(inventarioId, new Date().toISOString());
  return all.length;
}

async function runCatalogSync(): Promise<void> {
  if (!activeInventarioId || syncingCatalog) return;
  syncingCatalog = true;
  try {
    await syncCatalogIncremental(activeInventarioId);
  } catch {
    /* offline — tenta na próxima rodada */
  } finally {
    syncingCatalog = false;
  }
}

/** Envia coletas pendentes para o Supabase com backoff. */
export async function processPendingQueue(): Promise<void> {
  if (syncingQueue) return;
  syncingQueue = true;
  try {
    let usuarioId: string;
    try {
      usuarioId = await ensureUserId();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Usuário não identificado.';
      const pendentesSemUser = await listarColetasParaSync();
      for (const c of pendentesSemUser) {
        await marcarColetaFalha(c.id, msg, c.retry_count + 1);
      }
      return;
    }

    await liberarColetasTravadas();
    await preencherUsuarioIdPendentes(usuarioId);
    const pendentes = await listarColetasParaSync();
    for (const coleta of pendentes) {
      const coletaUsuarioId = coleta.usuario_id ?? usuarioId;
      await marcarColetaSyncing(coleta.id);
      try {
        if (coleta.tipo_registro === 'avaria' || coleta.tipo_registro === 'vencimento') {
          await registrarAvariaCloud(coleta, coletaUsuarioId);
        } else {
          await rpcCallPublic(
            'registrar_coleta_coletor',
            {
              p_usuario_id: coletaUsuarioId,
              p_inventario_id: coleta.inventario_id,
              p_codigo: coleta.codigo,
              p_quantidade: coleta.quantidade,
              p_lote: coleta.lote ?? null,
              p_tipo_coleta: 'coletor',
              p_is_produto_externo: coleta.is_produto_externo,
              p_produto_nome: coleta.produto_nome ?? null,
              ...(coleta.item_id ? { p_item_id: coleta.item_id } : {}),
              ...(coleta.numero_serie ? { p_numero_serie: coleta.numero_serie } : {}),
            },
            SAVE_TIMEOUT_MS,
          );
        }
        await marcarColetaSincronizada(coleta.id);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Erro desconhecido';
        await marcarColetaFalha(coleta.id, msg, coleta.retry_count + 1);
      }
    }
  } finally {
    syncingQueue = false;
  }
}

function stopBackgroundSync(): void {
  if (catalogTimer) {
    clearInterval(catalogTimer);
    catalogTimer = null;
  }
  if (queueTimer) {
    clearInterval(queueTimer);
    queueTimer = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
  activeInventarioId = null;
}

function startBackgroundSync(inventarioId: string): void {
  stopBackgroundSync();
  activeInventarioId = inventarioId;

  void runCatalogSync();
  void processPendingQueue();

  catalogTimer = setInterval(() => { void runCatalogSync(); }, CATALOG_SYNC_INTERVAL_MS);
  queueTimer = setInterval(() => { void processPendingQueue(); }, QUEUE_SYNC_INTERVAL_MS);

  const onAppState = (state: AppStateStatus) => {
    if (state === 'active') {
      void runCatalogSync();
      void processPendingQueue();
    }
  };
  appStateSub = AppState.addEventListener('change', onAppState);
}

export type EnterInventoryResult = {
  produtoCount: number;
  downloaded: boolean;
  offline: boolean;
};

/** Chamado ao entrar em um inventário — baixa catálogo e inicia sync em background. */
export async function enterInventory(
  inventario: Inventario,
  onProgress?: (progress: CatalogDownloadProgress) => void,
): Promise<EnterInventoryResult> {
  let produtoCount = 0;
  let downloaded = false;
  let offline = false;
  try {
    produtoCount = await downloadCatalog(inventario.id, onProgress);
    downloaded = true;
  } catch {
    offline = true;
    const meta = await getSyncMeta(inventario.id);
    produtoCount = meta?.produto_count ?? 0;
  }
  startBackgroundSync(inventario.id);
  return { produtoCount, downloaded, offline };
}

export function leaveInventory(): void {
  stopBackgroundSync();
}

/** Dispara sync da fila após salvar coleta localmente. */
export function triggerQueueSync(): void {
  void processPendingQueue();
}
