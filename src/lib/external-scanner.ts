/**
 * Debounce para leitor de barras externo (HID / laser industrial).
 * Paridade GSS — evita processar código antes da leitura completa.
 */
export type ExternalScannerSubmit = (normalizedCode: string) => void;

export type ExternalScannerHandlers = {
  onChangeText: (text: string) => void;
  onKeyPress: (event: { nativeEvent?: { key?: string } }) => void;
  submitNow: () => void;
  reset: () => void;
};

const DEBOUNCE_MS: Array<{ min: number; max: number; ms: number }> = [
  { min: 13, max: 99, ms: 800 },
  { min: 12, max: 12, ms: 2500 },
  { min: 8, max: 11, ms: 2000 },
  { min: 6, max: 7, ms: 3000 },
  { min: 1, max: 5, ms: 3500 },
];

function debounceForLength(len: number): number {
  for (const rule of DEBOUNCE_MS) {
    if (len >= rule.min && len <= rule.max) return rule.ms;
  }
  return 800;
}

export function createExternalScannerHandlers(
  onSubmit: ExternalScannerSubmit,
): ExternalScannerHandlers {
  let latestCode = '';
  let keyBuffer = '';
  let lastChangeAt = 0;
  let processing = false;
  let codeTimeout: ReturnType<typeof setTimeout> | null = null;
  let keyFlushTimeout: ReturnType<typeof setTimeout> | null = null;

  const clearCodeTimeout = () => {
    if (codeTimeout) {
      clearTimeout(codeTimeout);
      codeTimeout = null;
    }
  };

  const clearKeyFlushTimeout = () => {
    if (keyFlushTimeout) {
      clearTimeout(keyFlushTimeout);
      keyFlushTimeout = null;
    }
  };

  const submitNow = () => {
    clearCodeTimeout();
    clearKeyFlushTimeout();
    keyBuffer = '';
    processing = false;
    const code = latestCode.trim();
    latestCode = '';
    if (code) onSubmit(code);
  };

  const scheduleSubmit = (normalizedText: string) => {
    clearCodeTimeout();
    processing = true;
    codeTimeout = setTimeout(() => {
      processing = false;
      if (latestCode === normalizedText) submitNow();
    }, debounceForLength(normalizedText.length));
  };

  const onChangeText = (text: string) => {
    const normalized = text.replace(/[^0-9]/g, '');
    lastChangeAt = Date.now();
    latestCode = normalized;
    if (!normalized || processing) return;
    scheduleSubmit(normalized);
  };

  const onKeyPress = (event: { nativeEvent?: { key?: string } }) => {
    const key = event?.nativeEvent?.key;
    if (!key) return;

    const changeIsRecent = Date.now() - lastChangeAt < 80;
    const isSubmitKey = key === 'Enter' || key === '\n' || key === '\r' || key === 'Tab';

    if (isSubmitKey) {
      if (!changeIsRecent && keyBuffer) onChangeText(keyBuffer);
      keyBuffer = '';
      clearKeyFlushTimeout();
      submitNow();
      return;
    }

    if (changeIsRecent) return;

    if (key === 'Backspace') {
      keyBuffer = keyBuffer.slice(0, -1);
      onChangeText(keyBuffer);
      return;
    }

    if (!/^\d$/.test(key)) return;

    keyBuffer += key;
    onChangeText(keyBuffer);

    clearKeyFlushTimeout();
    keyFlushTimeout = setTimeout(() => {
      if (keyBuffer) {
        submitNow();
        keyBuffer = '';
      }
    }, 250);
  };

  const reset = () => {
    clearCodeTimeout();
    clearKeyFlushTimeout();
    latestCode = '';
    keyBuffer = '';
    processing = false;
  };

  return { onChangeText, onKeyPress, submitNow, reset };
}

export function normalizeExternalCode(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}
