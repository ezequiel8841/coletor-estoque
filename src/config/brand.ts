// White-label: identidade visual resolvida por organização (após login).
// Fallback = design system InvStock (cyan), não mais o laranja legado GSS.
import { supabase } from './supabase';
import { INVSTOCK_THEME } from './invstock-theme';

export type Brand = {
  nome: string;
  logoUrl: string | null;
  corPrimaria: string;
  corSecundaria: string;
};

export const DEFAULT_BRAND: Brand = {
  nome: 'InvStock Coletor',
  logoUrl: null,
  corPrimaria: INVSTOCK_THEME.primary,
  corSecundaria: INVSTOCK_THEME.background,
};

// Busca o branding da organização do usuário autenticado via RPC obter_branding_atual().
export async function fetchBrand(): Promise<Brand> {
  try {
    const { data, error } = await supabase.rpc('obter_branding_atual');
    if (error || !data) return DEFAULT_BRAND;
    return {
      nome: data.nome || DEFAULT_BRAND.nome,
      logoUrl: data.logo_url || null,
      corPrimaria: data.cor_primaria || DEFAULT_BRAND.corPrimaria,
      corSecundaria: data.cor_secundaria || DEFAULT_BRAND.corSecundaria,
    };
  } catch {
    return DEFAULT_BRAND;
  }
}
