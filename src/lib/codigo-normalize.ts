/** Porte de public.normalizar_codigo_coleta — dígitos apenas, sem zeros à esquerda. */
export function normalizarCodigoColeta(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.trim().replace(/[^0-9]/g, '');
  const stripped = digits.replace(/^0+/, '');
  return stripped || null;
}

/** Porte de public.normalizar_numero_serie — trim, upper, colapsa espaços. */
export function normalizarNumeroSerie(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, '');
  return normalized || null;
}

export type LookupMode = 'produto' | 'barcode' | 'serie';

/** SKU / código interno — preserva alfanumérico. */
export function normalizarCodigoProduto(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase();
  return normalized || null;
}
