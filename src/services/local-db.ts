// ============================================================================
// SQLite local — cache de produtos + fila de coletas pendentes.
// ============================================================================
import * as SQLite from 'expo-sqlite';
import { normalizarCodigoColeta, normalizarCodigoProduto, normalizarNumeroSerie, type LookupMode } from '../lib/codigo-normalize';
import type { Produto } from './collector';

const DB_NAME = 'coletor_offline.db';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export type TipoRegistro = 'coleta' | 'avaria' | 'vencimento';

export type ColetaLocal = {
  id: string;
  inventario_id: string;
  codigo: string;
  quantidade: number;
  lote: string | null;
  is_produto_externo: boolean;
  produto_nome: string | null;
  item_id: string | null;
  usuario_id: string | null;
  nome_exibicao: string;
  tipo_registro: TipoRegistro;
  organizacao_id: string | null;
  imagem_uri: string | null;
  observacoes: string | null;
  sync_status: SyncStatus;
  retry_count: number;
  next_retry_at: string | null;
  error_message: string | null;
  numero_serie: string | null;
  criado_em: string;
  sincronizado_em: string | null;
};

type ProdutoRow = {
  id: string;
  inventario_id: string;
  codigo_produto: string;
  nome_produto: string;
  codigo_barras_principal: string | null;
  codigo_barras_2: string | null;
  codigo_barras_3: string | null;
  atualizado_em: string | null;
  codigo_produto_norm: string | null;
  codigo_barras_principal_norm: string | null;
  codigo_barras_2_norm: string | null;
  codigo_barras_3_norm: string | null;
  modo_contagem: string | null;
};

type SyncMeta = {
  inventario_id: string;
  last_synced_at: string | null;
  catalog_ready: number;
  produto_count: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function generateLocalId(): string {
  return generateId();
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS produtos_cache (
          id TEXT PRIMARY KEY,
          inventario_id TEXT NOT NULL,
          codigo_produto TEXT NOT NULL,
          nome_produto TEXT NOT NULL,
          codigo_barras_principal TEXT,
          codigo_barras_2 TEXT,
          codigo_barras_3 TEXT,
          atualizado_em TEXT,
          codigo_produto_norm TEXT,
          codigo_barras_principal_norm TEXT,
          codigo_barras_2_norm TEXT,
          codigo_barras_3_norm TEXT,
          modo_contagem TEXT DEFAULT 'quantidade'
        );
        CREATE INDEX IF NOT EXISTS idx_produtos_inv ON produtos_cache(inventario_id);
        CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON produtos_cache(inventario_id, codigo_produto);
        CREATE INDEX IF NOT EXISTS idx_produtos_barras ON produtos_cache(inventario_id, codigo_barras_principal);

        CREATE TABLE IF NOT EXISTS seriais_cache (
          id TEXT PRIMARY KEY,
          inventario_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          numero_serie TEXT NOT NULL,
          numero_serie_norm TEXT NOT NULL,
          coletado INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_seriais_inv ON seriais_cache(inventario_id, numero_serie_norm);

        CREATE TABLE IF NOT EXISTS sync_meta (
          inventario_id TEXT PRIMARY KEY,
          last_synced_at TEXT,
          catalog_ready INTEGER DEFAULT 0,
          produto_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS coletas_local (
          id TEXT PRIMARY KEY,
          inventario_id TEXT NOT NULL,
          codigo TEXT NOT NULL,
          quantidade REAL NOT NULL,
          lote TEXT,
          is_produto_externo INTEGER DEFAULT 0,
          produto_nome TEXT,
          item_id TEXT,
          nome_exibicao TEXT NOT NULL,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          retry_count INTEGER DEFAULT 0,
          next_retry_at TEXT,
          error_message TEXT,
          criado_em TEXT NOT NULL,
          sincronizado_em TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_coletas_inv ON coletas_local(inventario_id);
        CREATE INDEX IF NOT EXISTS idx_coletas_status ON coletas_local(sync_status);
      `);
      try {
        await db.execAsync('ALTER TABLE coletas_local ADD COLUMN numero_serie TEXT;');
      } catch {
        /* coluna já existe */
      }
      try {
        await db.execAsync("ALTER TABLE produtos_cache ADD COLUMN modo_contagem TEXT DEFAULT 'quantidade';");
      } catch {
        /* coluna já existe */
      }
      try {
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS seriais_cache (
            id TEXT PRIMARY KEY,
            inventario_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            numero_serie TEXT NOT NULL,
            numero_serie_norm TEXT NOT NULL,
            coletado INTEGER DEFAULT 0
          );
        `);
        await db.execAsync('CREATE INDEX IF NOT EXISTS idx_seriais_inv ON seriais_cache(inventario_id, numero_serie_norm);');
      } catch {
        /* ok */
      }
      try {
        await db.execAsync('ALTER TABLE coletas_local ADD COLUMN usuario_id TEXT;');
      } catch {
        /* coluna já existe */
      }
      try {
        await db.execAsync("ALTER TABLE coletas_local ADD COLUMN tipo_registro TEXT NOT NULL DEFAULT 'coleta';");
      } catch {
        /* coluna já existe */
      }
      try {
        await db.execAsync('ALTER TABLE coletas_local ADD COLUMN organizacao_id TEXT;');
      } catch { /* ok */ }
      try {
        await db.execAsync('ALTER TABLE coletas_local ADD COLUMN imagem_uri TEXT;');
      } catch { /* ok */ }
      try {
        await db.execAsync('ALTER TABLE coletas_local ADD COLUMN observacoes TEXT;');
      } catch { /* ok */ }
      return db;
    });
  }
  return dbPromise;
}

function rowToProduto(row: ProdutoRow): Produto {
  return {
    id: row.id,
    codigo_produto: row.codigo_produto,
    nome_produto: row.nome_produto,
    codigo_barras_principal: row.codigo_barras_principal,
    modo_contagem: row.modo_contagem === 'numero_serie' ? 'numero_serie' : 'quantidade',
  };
}

function normFields(p: {
  codigo_produto: string;
  codigo_barras_principal?: string | null;
  codigo_barras_2?: string | null;
  codigo_barras_3?: string | null;
}) {
  return {
    codigo_produto_norm: normalizarCodigoColeta(p.codigo_produto),
    codigo_barras_principal_norm: normalizarCodigoColeta(p.codigo_barras_principal),
    codigo_barras_2_norm: normalizarCodigoColeta(p.codigo_barras_2),
    codigo_barras_3_norm: normalizarCodigoColeta(p.codigo_barras_3),
  };
}

export async function isCatalogReady(inventarioId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<SyncMeta>(
    'SELECT catalog_ready FROM sync_meta WHERE inventario_id = ?',
    [inventarioId],
  );
  return !!row?.catalog_ready;
}

export async function getSyncMeta(inventarioId: string): Promise<SyncMeta | null> {
  const db = await getDb();
  return db.getFirstAsync<SyncMeta>(
    'SELECT inventario_id, last_synced_at, catalog_ready, produto_count FROM sync_meta WHERE inventario_id = ?',
    [inventarioId],
  );
}

export async function upsertProdutos(
  inventarioId: string,
  produtos: Array<{
    id: string;
    codigo_produto: string;
    nome_produto: string;
    codigo_barras_principal?: string | null;
    codigo_barras_2?: string | null;
    codigo_barras_3?: string | null;
    atualizado_em?: string | null;
    modo_contagem?: string | null;
  }>,
): Promise<void> {
  if (produtos.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const p of produtos) {
      const norms = normFields(p);
      await db.runAsync(
        `INSERT INTO produtos_cache (
          id, inventario_id, codigo_produto, nome_produto,
          codigo_barras_principal, codigo_barras_2, codigo_barras_3, atualizado_em,
          codigo_produto_norm, codigo_barras_principal_norm, codigo_barras_2_norm, codigo_barras_3_norm,
          modo_contagem
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          codigo_produto = excluded.codigo_produto,
          nome_produto = excluded.nome_produto,
          codigo_barras_principal = excluded.codigo_barras_principal,
          codigo_barras_2 = excluded.codigo_barras_2,
          codigo_barras_3 = excluded.codigo_barras_3,
          atualizado_em = excluded.atualizado_em,
          codigo_produto_norm = excluded.codigo_produto_norm,
          codigo_barras_principal_norm = excluded.codigo_barras_principal_norm,
          codigo_barras_2_norm = excluded.codigo_barras_2_norm,
          codigo_barras_3_norm = excluded.codigo_barras_3_norm,
          modo_contagem = excluded.modo_contagem`,
        [
          p.id,
          inventarioId,
          p.codigo_produto,
          p.nome_produto,
          p.codigo_barras_principal ?? null,
          p.codigo_barras_2 ?? null,
          p.codigo_barras_3 ?? null,
          p.atualizado_em ?? null,
          norms.codigo_produto_norm,
          norms.codigo_barras_principal_norm,
          norms.codigo_barras_2_norm,
          norms.codigo_barras_3_norm,
          p.modo_contagem ?? 'quantidade',
        ],
      );
    }
  });
}

export async function replaceCatalog(
  inventarioId: string,
  produtos: Array<{
    id: string;
    codigo_produto: string;
    nome_produto: string;
    codigo_barras_principal?: string | null;
    codigo_barras_2?: string | null;
    codigo_barras_3?: string | null;
    atualizado_em?: string | null;
    modo_contagem?: string | null;
  }>,
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM produtos_cache WHERE inventario_id = ?', [inventarioId]);
    await db.runAsync('DELETE FROM seriais_cache WHERE inventario_id = ?', [inventarioId]);
    for (const p of produtos) {
      const norms = normFields(p);
      await db.runAsync(
        `INSERT INTO produtos_cache (
          id, inventario_id, codigo_produto, nome_produto,
          codigo_barras_principal, codigo_barras_2, codigo_barras_3, atualizado_em,
          codigo_produto_norm, codigo_barras_principal_norm, codigo_barras_2_norm, codigo_barras_3_norm,
          modo_contagem
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id,
          inventarioId,
          p.codigo_produto,
          p.nome_produto,
          p.codigo_barras_principal ?? null,
          p.codigo_barras_2 ?? null,
          p.codigo_barras_3 ?? null,
          p.atualizado_em ?? null,
          norms.codigo_produto_norm,
          norms.codigo_barras_principal_norm,
          norms.codigo_barras_2_norm,
          norms.codigo_barras_3_norm,
          p.modo_contagem ?? 'quantidade',
        ],
      );
    }
    await db.runAsync(
      `INSERT INTO sync_meta (inventario_id, last_synced_at, catalog_ready, produto_count)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(inventario_id) DO UPDATE SET
         last_synced_at = excluded.last_synced_at,
         catalog_ready = 1,
         produto_count = excluded.produto_count`,
      [inventarioId, now, produtos.length],
    );
  });
}

export async function updateSyncMeta(inventarioId: string, lastSyncedAt: string): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) AS c FROM produtos_cache WHERE inventario_id = ?',
    [inventarioId],
  );
  const count = row?.c ?? 0;
  await db.runAsync(
    `INSERT INTO sync_meta (inventario_id, last_synced_at, catalog_ready, produto_count)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(inventario_id) DO UPDATE SET
       last_synced_at = excluded.last_synced_at,
       catalog_ready = 1,
       produto_count = excluded.produto_count`,
    [inventarioId, lastSyncedAt, count],
  );
}

export async function buscarProdutoLocal(
  inventarioId: string,
  codigo: string,
  modo: LookupMode | 'auto' = 'auto',
): Promise<{ produto: Produto; codigoUsado: string } | null> {
  const db = await getDb();
  const trimmed = codigo.trim();

  if (modo === 'serie') {
    const bySerial = await buscarProdutoPorSerialLocal(inventarioId, codigo);
    if (!bySerial) return null;
    return { produto: bySerial.produto, codigoUsado: bySerial.codigoUsado };
  }

  const matchProduto = async (): Promise<{ produto: Produto; codigoUsado: string } | null> => {
    const exact = await db.getFirstAsync<ProdutoRow>(
      `SELECT * FROM produtos_cache
       WHERE inventario_id = ? AND codigo_produto = ?
       LIMIT 1`,
      [inventarioId, trimmed.toUpperCase()],
    );
    if (exact) return { produto: rowToProduto(exact), codigoUsado: trimmed };

    const norm = normalizarCodigoColeta(trimmed);
    if (!norm) return null;
    const fuzzy = await db.getFirstAsync<ProdutoRow>(
      `SELECT * FROM produtos_cache
       WHERE inventario_id = ? AND codigo_produto_norm = ?
       LIMIT 1`,
      [inventarioId, norm],
    );
    return fuzzy ? { produto: rowToProduto(fuzzy), codigoUsado: trimmed } : null;
  };

  const matchBarcode = async (): Promise<{ produto: Produto; codigoUsado: string } | null> => {
    const exact = await db.getFirstAsync<ProdutoRow>(
      `SELECT * FROM produtos_cache
       WHERE inventario_id = ?
         AND (
           codigo_barras_principal = ?
           OR codigo_barras_2 = ?
           OR codigo_barras_3 = ?
         )
       LIMIT 1`,
      [inventarioId, trimmed, trimmed, trimmed],
    );
    if (exact) return { produto: rowToProduto(exact), codigoUsado: trimmed };

    const norm = normalizarCodigoColeta(trimmed);
    if (!norm) return null;
    const fuzzy = await db.getFirstAsync<ProdutoRow>(
      `SELECT * FROM produtos_cache
       WHERE inventario_id = ?
         AND (
           codigo_barras_principal_norm = ?
           OR codigo_barras_2_norm = ?
           OR codigo_barras_3_norm = ?
         )
       LIMIT 1`,
      [inventarioId, norm, norm, norm],
    );
    return fuzzy ? { produto: rowToProduto(fuzzy), codigoUsado: trimmed } : null;
  };

  if (modo === 'produto') return matchProduto();
  if (modo === 'barcode') return matchBarcode();

  const exact = await db.getFirstAsync<ProdutoRow>(
    `SELECT * FROM produtos_cache
     WHERE inventario_id = ?
       AND (
         codigo_produto = ?
         OR codigo_barras_principal = ?
         OR codigo_barras_2 = ?
         OR codigo_barras_3 = ?
       )
     LIMIT 1`,
    [inventarioId, trimmed, trimmed, trimmed, trimmed],
  );
  if (exact) return { produto: rowToProduto(exact), codigoUsado: trimmed };

  const norm = normalizarCodigoColeta(trimmed);
  if (!norm) return null;

  const fuzzy = await db.getFirstAsync<ProdutoRow>(
    `SELECT * FROM produtos_cache
     WHERE inventario_id = ?
       AND (
         codigo_produto_norm = ?
         OR codigo_barras_principal_norm = ?
         OR codigo_barras_2_norm = ?
         OR codigo_barras_3_norm = ?
       )
     LIMIT 1`,
    [inventarioId, norm, norm, norm, norm],
  );
  if (fuzzy) return { produto: rowToProduto(fuzzy), codigoUsado: trimmed };

  return null;
}

export async function replaceSeriaisCache(
  inventarioId: string,
  seriais: Array<{ id: string; item_id: string; numero_serie: string; coletado?: boolean }>,
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM seriais_cache WHERE inventario_id = ?', [inventarioId]);
    for (const s of seriais) {
      const norm = normalizarNumeroSerie(s.numero_serie);
      if (!norm) continue;
      await db.runAsync(
        `INSERT INTO seriais_cache (id, inventario_id, item_id, numero_serie, numero_serie_norm, coletado)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [s.id, inventarioId, s.item_id, s.numero_serie, norm, s.coletado ? 1 : 0],
      );
    }
  });
}

export async function buscarProdutoPorSerialLocal(
  inventarioId: string,
  serial: string,
): Promise<{ produto: Produto; codigoUsado: string; numeroSerie: string } | null> {
  const db = await getDb();
  const norm = normalizarNumeroSerie(serial);
  if (!norm) return null;

  const row = await db.getFirstAsync<{ item_id: string; numero_serie: string }>(
    `SELECT item_id, numero_serie FROM seriais_cache
     WHERE inventario_id = ? AND numero_serie_norm = ?
     LIMIT 1`,
    [inventarioId, norm],
  );
  if (!row) return null;

  const produto = await db.getFirstAsync<ProdutoRow>(
    'SELECT * FROM produtos_cache WHERE inventario_id = ? AND id = ? LIMIT 1',
    [inventarioId, row.item_id],
  );
  if (!produto) return null;
  return { produto: rowToProduto(produto), codigoUsado: row.numero_serie, numeroSerie: row.numero_serie };
}

export async function serialJaColetadoLocal(inventarioId: string, serial: string): Promise<boolean> {
  const db = await getDb();
  const norm = normalizarNumeroSerie(serial);
  if (!norm) return false;

  const cached = await db.getFirstAsync<{ coletado: number }>(
    'SELECT coletado FROM seriais_cache WHERE inventario_id = ? AND numero_serie_norm = ? LIMIT 1',
    [inventarioId, norm],
  );
  if (cached?.coletado) return true;

  const pending = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM coletas_local
     WHERE inventario_id = ? AND numero_serie IS NOT NULL
       AND UPPER(REPLACE(numero_serie, ' ', '')) = ?
       AND sync_status IN ('pending', 'syncing', 'synced')`,
    [inventarioId, norm],
  );
  return (pending?.c ?? 0) > 0;
}

function mapColetaRow(r: {
  id: string;
  inventario_id: string;
  codigo: string;
  quantidade: number;
  lote: string | null;
  is_produto_externo: number;
  produto_nome: string | null;
  item_id: string | null;
  usuario_id: string | null;
  nome_exibicao: string;
  tipo_registro?: string | null;
  organizacao_id?: string | null;
  imagem_uri?: string | null;
  observacoes?: string | null;
  sync_status: SyncStatus;
  retry_count: number;
  next_retry_at: string | null;
  error_message: string | null;
  numero_serie?: string | null;
  criado_em: string;
  sincronizado_em: string | null;
}): ColetaLocal {
  const tipo = r.tipo_registro === 'avaria' || r.tipo_registro === 'vencimento'
    ? r.tipo_registro
    : 'coleta';
  return {
    id: r.id,
    inventario_id: r.inventario_id,
    codigo: r.codigo,
    quantidade: r.quantidade,
    lote: r.lote,
    is_produto_externo: !!r.is_produto_externo,
    produto_nome: r.produto_nome,
    item_id: r.item_id,
    usuario_id: r.usuario_id ?? null,
    nome_exibicao: r.nome_exibicao,
    tipo_registro: tipo,
    organizacao_id: r.organizacao_id ?? null,
    imagem_uri: r.imagem_uri ?? null,
    observacoes: r.observacoes ?? null,
    sync_status: r.sync_status,
    retry_count: r.retry_count,
    next_retry_at: r.next_retry_at,
    error_message: r.error_message,
    numero_serie: r.numero_serie ?? null,
    criado_em: r.criado_em,
    sincronizado_em: r.sincronizado_em,
  };
}

export async function inserirColetaLocal(params: {
  inventarioId: string;
  codigo: string;
  quantidade: number;
  lote?: string | null;
  isProdutoExterno?: boolean;
  produtoNome?: string | null;
  itemId?: string | null;
  usuarioId?: string | null;
  nomeExibicao: string;
  numeroSerie?: string | null;
}): Promise<ColetaLocal> {
  const db = await getDb();
  const id = generateId();
  const criadoEm = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO coletas_local (
      id, inventario_id, codigo, quantidade, lote,
      is_produto_externo, produto_nome, item_id, usuario_id, nome_exibicao,
      numero_serie, tipo_registro, sync_status, retry_count, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'coleta', 'pending', 0, ?)`,
    [
      id,
      params.inventarioId,
      params.codigo,
      params.quantidade,
      params.lote ?? null,
      params.isProdutoExterno ? 1 : 0,
      params.produtoNome ?? null,
      params.itemId ?? null,
      params.usuarioId ?? null,
      params.nomeExibicao,
      params.numeroSerie ?? null,
      criadoEm,
    ],
  );
  return {
    id,
    inventario_id: params.inventarioId,
    codigo: params.codigo,
    quantidade: params.quantidade,
    lote: params.lote ?? null,
    is_produto_externo: !!params.isProdutoExterno,
    produto_nome: params.produtoNome ?? null,
    item_id: params.itemId ?? null,
    usuario_id: params.usuarioId ?? null,
    nome_exibicao: params.nomeExibicao,
    numero_serie: params.numeroSerie ?? null,
    tipo_registro: 'coleta',
    organizacao_id: null,
    imagem_uri: null,
    observacoes: null,
    sync_status: 'pending',
    retry_count: 0,
    next_retry_at: null,
    error_message: null,
    criado_em: criadoEm,
    sincronizado_em: null,
  };
}

/** Enfileira avaria/vencimento localmente para sync em background. */
export async function inserirAvariaLocal(params: {
  id: string;
  inventarioId: string;
  organizacaoId: string;
  codigo: string;
  quantidade: number;
  nomeExibicao: string;
  tipoRegistro: 'avaria' | 'vencimento';
  imagemUri: string;
  observacoes?: string | null;
  usuarioId?: string | null;
}): Promise<ColetaLocal> {
  const db = await getDb();
  const id = params.id;
  const criadoEm = new Date().toISOString();
  const lote = params.tipoRegistro === 'avaria' ? 'AVARIA' : 'VENCIMENTO';
  await db.runAsync(
    `INSERT INTO coletas_local (
      id, inventario_id, organizacao_id, codigo, quantidade, lote,
      is_produto_externo, produto_nome, item_id, usuario_id, nome_exibicao,
      tipo_registro, imagem_uri, observacoes,
      sync_status, retry_count, criado_em
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    [
      id,
      params.inventarioId,
      params.organizacaoId,
      params.codigo,
      params.quantidade,
      lote,
      params.nomeExibicao,
      params.usuarioId ?? null,
      params.nomeExibicao,
      params.tipoRegistro,
      params.imagemUri,
      params.observacoes ?? null,
      criadoEm,
    ],
  );
  return {
    id,
    inventario_id: params.inventarioId,
    codigo: params.codigo,
    quantidade: params.quantidade,
    lote,
    is_produto_externo: false,
    produto_nome: params.nomeExibicao,
    item_id: null,
    usuario_id: params.usuarioId ?? null,
    nome_exibicao: params.nomeExibicao,
    tipo_registro: params.tipoRegistro,
    organizacao_id: params.organizacaoId,
    imagem_uri: params.imagemUri,
    observacoes: params.observacoes ?? null,
    sync_status: 'pending',
    retry_count: 0,
    next_retry_at: null,
    error_message: null,
    criado_em: criadoEm,
    sincronizado_em: null,
  };
}

export async function listarColetas(inventarioId: string): Promise<ColetaLocal[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    inventario_id: string;
    codigo: string;
    quantidade: number;
    lote: string | null;
    is_produto_externo: number;
    produto_nome: string | null;
    item_id: string | null;
    usuario_id: string | null;
    nome_exibicao: string;
    sync_status: SyncStatus;
    retry_count: number;
    next_retry_at: string | null;
    error_message: string | null;
    criado_em: string;
    sincronizado_em: string | null;
  }>(
    `SELECT * FROM coletas_local
     WHERE inventario_id = ?
     ORDER BY criado_em DESC`,
    [inventarioId],
  );
  return rows.map(mapColetaRow);
}

export async function contarPendentes(inventarioId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM coletas_local
     WHERE inventario_id = ? AND sync_status IN ('pending', 'syncing', 'failed')`,
    [inventarioId],
  );
  return row?.c ?? 0;
}

export async function listarColetasParaSync(): Promise<ColetaLocal[]> {
  const db = await getDb();
  const now = new Date().toISOString();
  const rows = await db.getAllAsync<{
    id: string;
    inventario_id: string;
    codigo: string;
    quantidade: number;
    lote: string | null;
    is_produto_externo: number;
    produto_nome: string | null;
    item_id: string | null;
    usuario_id: string | null;
    nome_exibicao: string;
    sync_status: SyncStatus;
    retry_count: number;
    next_retry_at: string | null;
    error_message: string | null;
    criado_em: string;
    sincronizado_em: string | null;
  }>(
    `SELECT * FROM coletas_local
     WHERE sync_status IN ('pending', 'failed')
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY criado_em ASC
     LIMIT 20`,
    [now],
  );
  return rows.map(mapColetaRow);
}

export async function marcarColetaSyncing(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE coletas_local SET sync_status = 'syncing', error_message = NULL WHERE id = ?`,
    [id],
  );
}

export async function marcarColetaSincronizada(id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE coletas_local SET sync_status = 'synced', sincronizado_em = ?, error_message = NULL WHERE id = ?`,
    [now, id],
  );
}

export async function marcarColetaFalha(id: string, error: string, retryCount: number): Promise<void> {
  const db = await getDb();
  const delays = [5_000, 15_000, 45_000, 120_000, 300_000];
  const delay = delays[Math.min(retryCount, delays.length - 1)] ?? 300_000;
  const nextRetry = new Date(Date.now() + delay).toISOString();
  const status: SyncStatus = retryCount >= 5 ? 'failed' : 'pending';
  await db.runAsync(
    `UPDATE coletas_local SET
       sync_status = ?,
       retry_count = ?,
       next_retry_at = ?,
       error_message = ?
     WHERE id = ?`,
    [status, retryCount, status === 'pending' ? nextRetry : null, error.slice(0, 200), id],
  );
}

export async function retentarColeta(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE coletas_local SET sync_status = 'pending', next_retry_at = NULL, error_message = NULL, retry_count = 0 WHERE id = ?`,
    [id],
  );
}

/** Coletas presas em "syncing" voltam para a fila (ex.: timeout / app fechado). */
export async function liberarColetasTravadas(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE coletas_local SET sync_status = 'pending', error_message = NULL WHERE sync_status = 'syncing'`,
  );
}

/** Preenche usuario_id em coletas antigas (antes da v1.0.8). */
export async function preencherUsuarioIdPendentes(usuarioId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE coletas_local SET usuario_id = ? WHERE usuario_id IS NULL AND sync_status IN ('pending', 'failed')`,
    [usuarioId],
  );
}

export async function resetarFilaParaRetry(inventarioId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE coletas_local SET
       sync_status = 'pending',
       next_retry_at = NULL,
       error_message = NULL,
       retry_count = 0
     WHERE inventario_id = ? AND sync_status IN ('pending', 'failed', 'syncing')`,
    [inventarioId],
  );
}
