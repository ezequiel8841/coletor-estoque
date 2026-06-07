import * as FileSystem from 'expo-file-system/legacy';
import { getStoragePublicUrl, rpcCallPublic, uploadStoragePublic } from '../lib/supabase-rest';
import type { ColetaLocal } from './local-db';

const UPLOAD_TIMEOUT_MS = 60_000;

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

export async function registrarAvariaCloud(coleta: ColetaLocal, usuarioId: string): Promise<void> {
  if (coleta.tipo_registro !== 'avaria' && coleta.tipo_registro !== 'vencimento') {
    throw new Error('Registro não é avaria/vencimento.');
  }
  if (!coleta.organizacao_id || !coleta.imagem_uri) {
    throw new Error('Dados incompletos para enviar avaria/vencimento.');
  }

  const info = await FileSystem.getInfoAsync(coleta.imagem_uri);
  if (!info.exists) {
    throw new Error('Imagem não encontrada no dispositivo.');
  }

  const base64 = await FileSystem.readAsStringAsync(coleta.imagem_uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = decodeBase64(base64);
  const path = `${coleta.organizacao_id}/${coleta.inventario_id}/${Date.now()}.jpg`;

  await uploadStoragePublic('inventory-damages', path, bytes, 'image/jpeg', UPLOAD_TIMEOUT_MS);

  const urlImagem = getStoragePublicUrl('inventory-damages', path);
  const observacoes =
    coleta.observacoes ??
    (coleta.tipo_registro === 'avaria' ? 'Produto avariado' : 'Produto vencido');

  const data = await rpcCallPublic<{ id: string }>(
    'registrar_avaria_coletor',
    {
      p_usuario_id: usuarioId,
      p_organizacao_id: coleta.organizacao_id,
      p_inventario_id: coleta.inventario_id,
      p_codigo_produto: coleta.codigo,
      p_nome_produto: coleta.nome_exibicao,
      p_quantidade: coleta.quantidade,
      p_tipo: coleta.tipo_registro,
      p_url_imagem: urlImagem,
      p_observacoes: observacoes,
      p_codigo_barras: coleta.codigo,
    },
    UPLOAD_TIMEOUT_MS,
  );

  if (!data?.id) throw new Error('Falha ao registrar avaria.');
}
