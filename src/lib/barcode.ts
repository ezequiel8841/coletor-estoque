// ============================================================================
// Regras de código de barras — porte fiel do Coletor GSS (ScannerScreen.tsx).
// Mantém o comportamento de perecíveis, etiquetas de preço, EAN interno,
// correção de zeros à esquerda e geração de variações para busca.
// ============================================================================

export type ExtractResult = {
  code: string;
  message?: string; // feedback opcional para a UI (toast)
};

/** Limpa a leitura crua: remove tudo que não é dígito (CR/LF/Tab de leitores). */
export function cleanBarcode(raw: string): string {
  return (raw ?? '').trim().replace(/[^0-9]/g, '');
}

/** Aceita qualquer código numérico com 1+ dígitos. */
export function validateBarcode(code: string): { ok: boolean; message?: string } {
  if (!code || code.length < 1) {
    return { ok: false, message: 'Código de barras vazio. Tente novamente.' };
  }
  if (!/^\d+$/.test(code)) {
    return { ok: false, message: 'Código de barras inválido. Deve conter apenas números.' };
  }
  return { ok: true };
}

/** Códigos de 12 dígitos costumam ter perdido um zero à esquerda (EAN-13). */
export function fixMissingLeadingZeros(code: string): ExtractResult {
  if (code.length === 12) {
    const withZero = '0' + code;
    return { code: withZero, message: `Código corrigido: ${withZero}` };
  }
  return { code };
}

/**
 * Extrai o código do produto a partir do código de barras lido.
 * Trata perecíveis (prefixo 2), etiquetas de preço (23), EAN interno (7000/700000).
 */
export function extractProductCode(barcode: string): ExtractResult {
  // Código simples de 6 dígitos
  if (barcode.length === 6 && /^\d{6}$/.test(barcode)) {
    return { code: barcode };
  }

  // EAN-13 "normal" (busca integral)
  if (barcode.length === 13 && !barcode.startsWith('2') && !barcode.startsWith('7000')) {
    return { code: barcode };
  }

  // Perecível / etiqueta de preço (prefixo 2, 13 dígitos)
  if (barcode.startsWith('2') && barcode.length === 13) {
    if (barcode.startsWith('23')) {
      const productCode = barcode.substring(1, 7); // posições 1-6
      return { code: productCode, message: `Etiqueta de preço: ${productCode}` };
    }
    const productCode = barcode.substring(1, 7);
    return { code: productCode, message: `Produto perecível (13d): ${productCode}` };
  }

  // EAN interno (prefixo 7000, 13 dígitos)
  if (barcode.startsWith('7000') && barcode.length === 13) {
    if (barcode.startsWith('700000')) {
      return { code: barcode, message: `EAN interno completo: ${barcode}` };
    }
    const productCode = barcode.substring(6, 12); // posições 6-11
    return { code: productCode, message: `Código EAN interno: ${productCode}` };
  }

  // Produto normal
  return { code: barcode };
}

/** Gera variações do código para tentativa de busca (zeros à esquerda / padding). */
export function barcodeVariations(code: string): string[] {
  const tried = new Set<string>();
  const variations: string[] = [];
  const push = (v: string) => {
    if (v && !tried.has(v)) {
      variations.push(v);
      tried.add(v);
    }
  };

  push(code);

  const stripped = code.replace(/^0+/, '');
  if (stripped && stripped !== code) push(stripped);

  if (code.length === 6 && /^\d{6}$/.test(code)) {
    push(`0${code}`);
    push(`00${code}`);
  }

  for (const base of [code, stripped]) {
    if (!base) continue;
    for (const len of [13, 14]) {
      if (base.length < len) push(base.padStart(len, '0'));
    }
  }

  return variations;
}

/** Pipeline completo: crua -> limpa -> valida -> corrige zeros -> extrai produto. */
export function processScan(raw: string): {
  ok: boolean;
  productCode?: string;
  variations?: string[];
  message?: string;
} {
  const cleaned = cleanBarcode(raw);
  const valid = validateBarcode(cleaned);
  if (!valid.ok) return { ok: false, message: valid.message };

  const corrected = fixMissingLeadingZeros(cleaned);
  const extracted = extractProductCode(corrected.code);
  return {
    ok: true,
    productCode: extracted.code,
    variations: barcodeVariations(extracted.code),
    message: extracted.message ?? corrected.message,
  };
}

/** Leitura de número de série — preserva alfanumérico (não remove letras). */
export function processScanSerial(raw: string): {
  ok: boolean;
  serial?: string;
  message?: string;
} {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, message: 'Número de série vazio.' };
  const serial = trimmed.toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9\-_.]+$/.test(serial)) {
    return { ok: false, message: 'Número de série inválido.' };
  }
  return { ok: true, serial };
}
