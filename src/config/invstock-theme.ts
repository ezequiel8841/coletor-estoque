/**
 * Tokens visuais do InvStock (espelha clear-stock-scope/src/styles.css).
 * Usados como fallback quando a organização não define branding próprio.
 */
export const INVSTOCK_THEME = {
  /** oklch(0.68 0.14 215) — cyan principal da web */
  primary: '#06B6D4',
  /** oklch(0.129 0.042 264.695) — fundo escuro (dark mode) */
  background: '#0F172A',
  /** oklch(0.984 0.003 247.858) — texto sobre fundo escuro */
  foreground: '#F8FAFC',
  /** oklch(0.97 0.02 220) — superfície secundária clara */
  secondary: '#F0F9FF',
  /** oklch(0.32 0.07 235) — texto sobre superfície clara */
  secondaryForeground: '#1E3A5F',
  /** oklch(0.52 0.04 235) — texto auxiliar */
  mutedForeground: '#64748B',
  /** oklch(0.92 0.02 225) — bordas */
  border: '#E2E8F0',
  /** oklch(0.72 0.17 145) — cor de destaque / accent */
  accent: '#22C55E',
} as const;
