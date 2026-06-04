// ============================================================================
// Serviço do coletor — fala direto com o Supabase do InvStock (RLS protege).
// Substitui as APIs PHP do GSS (api_coletor.php / coletas_avarias.php).
// ============================================================================
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../config/supabase';
import { barcodeVariations } from '../lib/barcode';
import { withTimeout } from '../lib/with-timeout';

const REQUEST_TIMEOUT_MS = 20_000;

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

function buildBarcodeOrFilter(variations: string[]): string {
  return variations
    .flatMap((v) => [
      `codigo_barras_principal.eq.${v}`,
      `codigo_barras_2.eq.${v}`,
      `codigo_barras_3.eq.${v}`,
      `codigo_produto.eq.${v}`,
    ])
    .join(',');
}

/** Inventários acessíveis ao usuário (RLS já filtra por organização/empresa). */
export async function listarInventarios(): Promise<Inventario[]> {
  const { data, error } = await withTimeout(
    supabase
      .from('inventarios')
      .select('id, nome, setor, status, codigo_acesso, organizacao_id')
      .in('status', ['scheduled', 'in_progress'])
      .order('criado_em', { ascending: false }),
    REQUEST_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  return (data ?? []) as Inventario[];
}

/** Resolve inventário pelo código de acesso curto (paridade com o token GSS). */
export async function buscarInventarioPorCodigo(codigo: string): Promise<Inventario | null> {
  const { data, error } = await withTimeout(
    supabase
      .from('inventarios')
      .select('id, nome, setor, status, codigo_acesso, organizacao_id')
      .eq('codigo_acesso', codigo.trim())
      .maybeSingle(),
    REQUEST_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  return (data as Inventario) ?? null;
}

/**
 * Consulta um produto no inventário (RPC server-side com fallback em 1 query).
 */
export async function consultarProduto(
  inventarioId: string,
  productCode: string,
): Promise<{ produto: Produto; codigoUsado: string } | null> {
  const variations = barcodeVariations(productCode);
  let useFallback = false;

  for (const variation of variations) {
    const { data, error } = await withTimeout(
      supabase.rpc('consultar_produto_inventario', {
        p_inventario_id: inventarioId,
        p_codigo: variation,
      }),
      REQUEST_TIMEOUT_MS,
    );

    if (error) {
      if (/Could not find the function|42883|PGRST202/i.test(error.message)) {
        useFallback = true;
        break;
      }
      throw new Error(error.message);
    }
    if (data) {
      return { produto: data as Produto, codigoUsado: variation };
    }
  }

  if (!useFallback) return null;

  const { data, error } = await withTimeout(
    supabase
      .from('itens_inventario')
      .select('id, codigo_produto, nome_produto, codigo_barras_principal, codigo_barras_2, codigo_barras_3')
      .eq('inventario_id', inventarioId)
      .or(buildBarcodeOrFilter(variations))
      .limit(1)
      .maybeSingle(),
    REQUEST_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  if (!data) return null;

  const matched =
    variations.find(
      (v) =>
        data.codigo_barras_principal === v
        || data.codigo_barras_2 === v
        || data.codigo_barras_3 === v
        || data.codigo_produto === v,
    ) ?? productCode;
  return { produto: data as Produto, codigoUsado: matched };
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
  const { data, error } = await withTimeout(
    supabase.rpc('registrar_coleta', {
      p_inventario_id: params.inventarioId,
      p_codigo: params.codigo,
      p_quantidade: params.quantidade,
      p_lote: params.lote ?? null,
      p_tipo_coleta: 'coletor',
      p_is_produto_externo: params.isProdutoExterno ?? false,
      p_produto_nome: params.produtoNome ?? null,
    }),
    REQUEST_TIMEOUT_MS,
    'Tempo esgotado ao salvar a coleta. Verifique a conexão.',
  );
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
  const base64 = await FileSystem.readAsStringAsync(params.imagemUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = decodeBase64(base64);
  const path = `${params.organizacaoId}/${params.inventarioId}/${Date.now()}.jpg`;

  const { error: upErr } = await withTimeout(
    supabase.storage.from('inventory-damages').upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: false,
    }),
    REQUEST_TIMEOUT_MS,
  );
  if (upErr) throw new Error(`Falha no upload da imagem: ${upErr.message}`);

  const { data: pub } = supabase.storage.from('inventory-damages').getPublicUrl(path);

  const { data, error } = await withTimeout(
    supabase
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
      .single(),
    REQUEST_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  return data as { id: string };
}

/** Identifica produto por foto via Edge Function (Gemini no Supabase — chave nunca no app). */
export async function identificarProdutoPorImagem(params: {
  inventarioId: string;
  codigoBarras: string;
  imageBase64: string;
  mimeType?: string;
}): Promise<{ found: boolean; product_name: string | null; brand: string | null; code: string | null }> {
  const { data, error } = await withTimeout(
    supabase.functions.invoke("identify-product-image", {
      body: {
        inventario_id: params.inventarioId,
        codigo_barras: params.codigoBarras,
        image_base64: params.imageBase64,
        mime_type: params.mimeType ?? "image/jpeg",
      },
    }),
    REQUEST_TIMEOUT_MS,
    "Tempo esgotado ao identificar produto por foto.",
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
