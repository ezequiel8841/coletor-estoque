// ============================================================================
// Serviço do coletor — fala direto com o Supabase do InvStock (RLS protege).
// Substitui as APIs PHP do GSS (api_coletor.php / coletas_avarias.php).
// ============================================================================
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../config/supabase';
import { barcodeVariations } from '../lib/barcode';

export type Inventario = {
  id: string;
  nome: string;
  setor: string;
  status: 'scheduled' | 'in_progress' | 'completed';
  codigo_acesso: string | null;
  organizacao_id: string;
};

export type Produto = {
  id: string;
  codigo_produto: string;
  nome_produto: string;
  codigo_barras_principal: string | null;
};

// Lotes fixos (paridade com o GSS). AVARIA/VENCIMENTO exigem foto (+ data no vencimento).
export const LOTES = [
  'Area de venda',
  'Deposito',
  'Anexo',
  'Lote 1',
  'Lote 2',
  'Lote 3',
  'Lote 4',
  'Lote 5',
  'AVARIA',
  'VENCIMENTO',
];

/** Inventários acessíveis ao usuário (RLS já filtra por organização/empresa). */
export async function listarInventarios(): Promise<Inventario[]> {
  const { data, error } = await supabase
    .from('inventarios')
    .select('id, nome, setor, status, codigo_acesso, organizacao_id')
    .in('status', ['scheduled', 'in_progress'])
    .order('criado_em', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Inventario[];
}

/** Resolve inventário pelo código de acesso curto (paridade com o token GSS). */
export async function buscarInventarioPorCodigo(codigo: string): Promise<Inventario | null> {
  const { data, error } = await supabase
    .from('inventarios')
    .select('id, nome, setor, status, codigo_acesso, organizacao_id')
    .eq('codigo_acesso', codigo.trim().toUpperCase())
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Inventario) ?? null;
}

/**
 * Consulta um produto no inventário tentando as variações do código
 * (zeros à esquerda / padding), casando em barras 1/2/3 ou no código do produto.
 */
export async function consultarProduto(
  inventarioId: string,
  productCode: string,
): Promise<{ produto: Produto; codigoUsado: string } | null> {
  for (const variation of barcodeVariations(productCode)) {
    const { data, error } = await supabase
      .from('itens_inventario')
      .select('id, codigo_produto, nome_produto, codigo_barras_principal')
      .eq('inventario_id', inventarioId)
      .or(
        [
          `codigo_barras_principal.eq.${variation}`,
          `codigo_barras_2.eq.${variation}`,
          `codigo_barras_3.eq.${variation}`,
          `codigo_produto.eq.${variation}`,
        ].join(','),
      )
      .limit(1)
      .maybeSingle();
    if (error) continue;
    if (data) return { produto: data as Produto, codigoUsado: variation };
  }
  return null;
}

/** Registra uma coleta via RPC (insere evento + recalcula quantidade_contada). */
export async function registrarColeta(params: {
  inventarioId: string;
  codigo: string;
  quantidade: number;
  lote?: string | null;
  isProdutoExterno?: boolean;
  produtoNome?: string;
}): Promise<{ total_coletado: number; produto: string }> {
  if (params.quantidade <= 0) throw new Error('Quantidade deve ser maior que zero.');
  const { data, error } = await supabase.rpc('registrar_coleta', {
    p_inventario_id: params.inventarioId,
    p_codigo: params.codigo,
    p_quantidade: params.quantidade,
    p_lote: params.lote ?? null,
    p_tipo_coleta: 'coletor',
    p_is_produto_externo: params.isProdutoExterno ?? false,
    p_produto_nome: params.produtoNome ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { total_coletado: number; produto: string };
}

/**
 * Registra avaria/vencimento: faz upload da foto no bucket inventory-damages
 * (pasta = organizacao_id) e insere em avarias_inventario com url_imagem.
 */
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
  // 1) Ler imagem como base64 e converter para bytes para upload
  const base64 = await FileSystem.readAsStringAsync(params.imagemUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = decodeBase64(base64);
  const path = `${params.organizacaoId}/${params.inventarioId}/${Date.now()}.jpg`;

  const { error: upErr } = await supabase.storage
    .from('inventory-damages')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (upErr) throw new Error(`Falha no upload da imagem: ${upErr.message}`);

  const { data: pub } = supabase.storage.from('inventory-damages').getPublicUrl(path);

  // 2) Inserir registro de avaria
  const { data, error } = await supabase
    .from('avarias_inventario')
    .insert({
      organizacao_id: params.organizacaoId,
      inventario_id: params.inventarioId,
      codigo_produto: params.codigo,
      nome_produto: params.nomeProduto,
      quantidade: params.quantidade,
      tipo: params.tipo,
      observacoes:
        params.observacoes ??
        (params.dataVencimento
          ? `Validade: ${params.dataVencimento.toISOString().slice(0, 10)}`
          : null),
      url_imagem: pub.publicUrl,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string };
}

// Decodifica base64 -> Uint8Array (sem depender de Buffer no RN).
function decodeBase64(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const len = b64.length;
  let bufferLength = len * 0.75;
  if (b64[len - 1] === '=') bufferLength--;
  if (b64[len - 2] === '=') bufferLength--;
  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const e1 = lookup[b64.charCodeAt(i)];
    const e2 = lookup[b64.charCodeAt(i + 1)];
    const e3 = lookup[b64.charCodeAt(i + 2)];
    const e4 = lookup[b64.charCodeAt(i + 3)];
    bytes[p++] = (e1 << 2) | (e2 >> 4);
    if (p < bufferLength) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (p < bufferLength) bytes[p++] = ((e3 & 3) << 6) | (e4 & 63);
  }
  return bytes;
}
