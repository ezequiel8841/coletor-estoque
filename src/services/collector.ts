// ============================================================================
// Serviço do coletor — offline-first com fallback Supabase REST.
// ============================================================================
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../config/supabase';
import { getUserIdCache, rpcCall } from '../lib/supabase-rest';
import { withTimeout } from '../lib/with-timeout';
import { buscarProdutoLocal, generateLocalId, inserirAvariaLocal, inserirColetaLocal, isCatalogReady, serialJaColetadoLocal } from './local-db';
import { triggerQueueSync } from './sync';

export const REQUEST_TIMEOUT_MS = 10_000;
export const LOOKUP_TIMEOUT_MS = 8_000;
export const SAVE_TIMEOUT_MS = 30_000;

export type Inventario = {
  id: string;
  nome: string;
  setor: string;
  status: 'aberto' | 'em_andamento' | 'divergencia' | 'concluido';
  codigo_acesso: string | null;
  organizacao_id: string;
};

const STATUS_LABEL: Record<Inventario['status'], string> = {
  aberto: 'Aberto',
  em_andamento: 'Em andamento',
  divergencia: 'Divergência',
  concluido: 'Concluído',
};

export function inventarioStatusLabel(status: string): string {
  return STATUS_LABEL[status as Inventario['status']] ?? status;
}

const COLETA_STATUSES: Inventario['status'][] = ['em_andamento', 'divergencia'];

export function inventarioAceitaColeta(status: string): boolean {
  return COLETA_STATUSES.includes(status as Inventario['status']);
}

export type Produto = {
  id: string;
  codigo_produto: string;
  nome_produto: string;
  codigo_barras_principal: string | null;
  modo_contagem?: 'quantidade' | 'numero_serie';
  numero_serie?: string | null;
  serie_esperada?: boolean;
};

export type ProdutoLookup = {
  produto: Produto;
  codigoUsado: string;
  fromCache: boolean;
  numeroSerie?: string | null;
};

export const LOTES = [
  'Area de venda',
  'Deposito',
  'Anexo',
  'Lote 1',
  'Lote 2',
  'Lote 3',
  'Lote 4',
  'Lote 5',
  'RMA',
  'AVARIA',
  'VENCIMENTO',
];

const INVENTARIO_SELECT = 'id,nome,setor,status,codigo_acesso,organizacao_id';
const CODIGO_ACESSO_RE = /^[A-Za-z0-9]{6}$/;

export function normalizarCodigoAcesso(codigo: string): string {
  return codigo.trim().toUpperCase();
}

export function codigoAcessoValido(codigo: string): boolean {
  return CODIGO_ACESSO_RE.test(codigo.trim());
}

function mapInventarioRow(row: Inventario): Inventario {
  return {
    id: row.id,
    nome: row.nome,
    setor: row.setor,
    status: row.status,
    codigo_acesso: row.codigo_acesso,
    organizacao_id: row.organizacao_id,
  };
}

/** Inventários acessíveis ao usuário (em andamento / divergência). */
export async function listarInventarios(): Promise<Inventario[]> {
  const data = await rpcCall<Inventario[]>('listar_inventarios_coletor', {}, REQUEST_TIMEOUT_MS);
  return (data ?? []).map(mapInventarioRow);
}

export async function buscarInventarioPorCodigo(codigo: string): Promise<Inventario | null> {
  const normalized = normalizarCodigoAcesso(codigo);
  if (!codigoAcessoValido(normalized)) {
    throw new Error('O código de acesso deve ter 6 caracteres (letras ou números).');
  }
  const row = await rpcCall<Inventario | null>(
    'buscar_inventario_por_codigo_coletor',
    { p_codigo: normalized },
    REQUEST_TIMEOUT_MS,
  );
  const inv = row ? mapInventarioRow(row) : null;
  if (inv && !inventarioAceitaColeta(inv.status)) {
    throw new Error('Inventário não iniciado. Peça para iniciar a contagem na web.');
  }
  return inv;
}

/** Consulta produto — cache local primeiro, RPC como fallback. */
export async function consultarProduto(
  inventarioId: string,
  productCode: string,
): Promise<ProdutoLookup | null> {
  const cached = await isCatalogReady(inventarioId);
  if (cached) {
    const local = await buscarProdutoLocal(inventarioId, productCode, 'auto');
    if (local) return { ...local, fromCache: true };
  }

  try {
    const data = await rpcCall<Produto | null>(
      'consultar_produto_inventario',
      {
        p_inventario_id: inventarioId,
        p_codigo: productCode,
        p_modo_busca: 'auto',
      },
      LOOKUP_TIMEOUT_MS,
    );
    if (!data) return null;
    const produto: Produto = {
      id: data.id,
      codigo_produto: data.codigo_produto,
      nome_produto: data.nome_produto,
      codigo_barras_principal: data.codigo_barras_principal,
      modo_contagem: (data as Produto).modo_contagem ?? 'quantidade',
      numero_serie: (data as Produto).numero_serie ?? null,
      serie_esperada: (data as Produto).serie_esperada,
    };
    return {
      produto,
      codigoUsado: productCode,
      fromCache: false,
      numeroSerie: produto.numero_serie ?? null,
    };
  } catch {
    if (cached) {
      const local = await buscarProdutoLocal(inventarioId, productCode, 'auto');
      if (local) return { ...local, fromCache: true };
      return null;
    }
    throw new Error('Sem conexão e catálogo não disponível offline.');
  }
}

/** RPC direto — usado pela fila de sincronização. */
export async function registrarColetaCloud(params: {
  inventarioId: string;
  codigo: string;
  quantidade: number;
  lote?: string | null;
  isProdutoExterno?: boolean;
  produtoNome?: string;
  itemId?: string;
  numeroSerie?: string | null;
}): Promise<{ total_coletado: number; produto: string }> {
  if (params.quantidade <= 0) throw new Error('Quantidade deve ser maior que zero.');
  return rpcCall(
    'registrar_coleta',
    {
      p_inventario_id: params.inventarioId,
      p_codigo: params.codigo,
      p_quantidade: params.quantidade,
      p_lote: params.lote ?? null,
      p_tipo_coleta: 'coletor',
      p_is_produto_externo: params.isProdutoExterno ?? false,
      p_produto_nome: params.produtoNome ?? null,
      ...(params.itemId ? { p_item_id: params.itemId } : {}),
      ...(params.numeroSerie ? { p_numero_serie: params.numeroSerie } : {}),
    },
    SAVE_TIMEOUT_MS,
  );
}

/** Salva coleta localmente (otimista) e enfileira sync em background. */
export async function salvarColeta(params: {
  inventarioId: string;
  codigo: string;
  quantidade: number;
  lote?: string | null;
  isProdutoExterno?: boolean;
  produtoNome?: string;
  itemId?: string;
  nomeExibicao: string;
  numeroSerie?: string | null;
}): Promise<{ localId: string }> {
  if (params.numeroSerie) {
    if (params.quantidade !== 1) throw new Error('Itens com série exigem quantidade 1.');
    const dup = await serialJaColetadoLocal(params.inventarioId, params.numeroSerie);
    if (dup) throw new Error('Número de série já coletado neste inventário.');
  } else if (params.quantidade <= 0) {
    throw new Error('Quantidade deve ser maior que zero.');
  }
  const coleta = await inserirColetaLocal({
    inventarioId: params.inventarioId,
    codigo: params.codigo,
    quantidade: params.numeroSerie ? 1 : params.quantidade,
    lote: params.lote,
    isProdutoExterno: params.isProdutoExterno,
    produtoNome: params.produtoNome,
    itemId: params.itemId,
    usuarioId: getUserIdCache(),
    nomeExibicao: params.nomeExibicao,
    numeroSerie: params.numeroSerie ?? null,
  });
  triggerQueueSync();
  return { localId: coleta.id };
}

/** @deprecated Use salvarColeta — mantido para compatibilidade com fluxo online direto. */
export async function registrarColeta(params: {
  inventarioId: string;
  codigo: string;
  quantidade: number;
  lote?: string | null;
  isProdutoExterno?: boolean;
  produtoNome?: string;
  itemId?: string;
}): Promise<{ total_coletado: number; produto: string }> {
  if (params.quantidade <= 0) throw new Error('Quantidade deve ser maior que zero.');
  return rpcCall(
    'registrar_coleta',
    {
      p_inventario_id: params.inventarioId,
      p_codigo: params.codigo,
      p_quantidade: params.quantidade,
      p_lote: params.lote ?? null,
      p_tipo_coleta: 'coletor',
      p_is_produto_externo: params.isProdutoExterno ?? false,
      p_produto_nome: params.produtoNome ?? null,
      ...(params.itemId ? { p_item_id: params.itemId } : {}),
    },
    SAVE_TIMEOUT_MS,
  );
}

async function persistirImagemAvaria(imagemUri: string, localId: string): Promise<string> {
  const dir = `${FileSystem.documentDirectory}coletor_avarias/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const dest = `${dir}${localId}.jpg`;
  await FileSystem.copyAsync({ from: imagemUri, to: dest });
  return dest;
}

/** Salva avaria/vencimento localmente (otimista) e enfileira sync em background. */
export async function salvarAvaria(params: {
  organizacaoId: string;
  inventarioId: string;
  codigo: string;
  nomeProduto: string;
  quantidade: number;
  tipo: 'avaria' | 'vencimento';
  imagemUri: string;
  dataVencimento?: Date;
  observacoes?: string;
}): Promise<{ localId: string }> {
  if (params.quantidade <= 0) throw new Error('Quantidade deve ser maior que zero.');

  const observacoes =
    params.observacoes ??
    (params.dataVencimento
      ? `Validade: ${params.dataVencimento.toISOString().slice(0, 10)}`
      : null);

  const localId = generateLocalId();
  const imagemPersistida = await persistirImagemAvaria(params.imagemUri, localId);

  const coleta = await inserirAvariaLocal({
    id: localId,
    inventarioId: params.inventarioId,
    organizacaoId: params.organizacaoId,
    codigo: params.codigo,
    quantidade: params.quantidade,
    nomeExibicao: params.nomeProduto,
    tipoRegistro: params.tipo,
    imagemUri: imagemPersistida,
    observacoes,
    usuarioId: getUserIdCache(),
  });

  triggerQueueSync();
  return { localId: coleta.id };
}

/** @deprecated Use salvarAvaria */
export async function registrarAvaria(params: {
  organizacaoId: string;
  inventarioId: string;
  codigo: string;
  nomeProduto: string;
  quantidade: number;
  tipo: 'avaria' | 'vencimento';
  imagemUri: string;
  dataVencimento?: Date;
  observacoes?: string;
}): Promise<{ id: string }> {
  const result = await salvarAvaria(params);
  return { id: result.localId };
}

export async function identificarProdutoPorImagem(params: {
  inventarioId: string;
  codigoBarras: string;
  imageBase64: string;
  mimeType?: string;
}): Promise<{ found: boolean; product_name: string | null; brand: string | null; code: string | null }> {
  const { data, error } = await withTimeout(
    supabase.functions.invoke('identify-product-image', {
      body: {
        inventario_id: params.inventarioId,
        codigo_barras: params.codigoBarras,
        image_base64: params.imageBase64,
        mime_type: params.mimeType ?? 'image/jpeg',
      },
    }),
    REQUEST_TIMEOUT_MS,
    'Tempo esgotado ao identificar produto por foto.',
  );
  if (error) throw new Error(error.message);
  const payload = data as {
    found?: boolean;
    product_name?: string | null;
    brand?: string | null;
    code?: string | null;
    error?: string;
  };
  if (payload.error) throw new Error(payload.error);
  return {
    found: !!payload.found,
    product_name: payload.product_name ?? null,
    brand: payload.brand ?? null,
    code: payload.code ?? params.codigoBarras,
  };
}
