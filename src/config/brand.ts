// White-label: identidade visual resolvida por organização (após login).
// Espelha clear-stock-scope/src/config/brand.ts no lado web.
import { supabase } from './supabase';

export type Brand = {
  nome: string;
  logoUrl: string | null;
  corPrimaria: string;
  corSecundaria: string;
};

export const DEFAULT_BRAND: Brand = {
  nome: 'Coletor Estoque',
  logoUrl: null,
  corPrimaria: '#FF6B35',
  corSecundaria: '#0B1220',
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
