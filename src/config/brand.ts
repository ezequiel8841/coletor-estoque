// White-label: identidade visual resolvida por organização (após login).
import { rpcCall } from '../lib/supabase-rest';
import { INVSTOCK_THEME } from './invstock-theme';

export type Brand = {
  nome: string;
  logoUrl: string | null;
  corPrimaria: string;
  corSecundaria: string;
  corDestaque: string;
};

type BrandingRow = {
  nome?: string | null;
  logo_url?: string | null;
  cor_primaria?: string | null;
  cor_secundaria?: string | null;
  cor_destaque?: string | null;
};

export const DEFAULT_BRAND: Brand = {
  nome: 'InvStock Coletor',
  logoUrl: null,
  corPrimaria: INVSTOCK_THEME.primary,
  corSecundaria: INVSTOCK_THEME.background,
  corDestaque: INVSTOCK_THEME.accent,
};

function mapBrandingRow(data: BrandingRow): Brand {
  return {
    nome: data.nome || DEFAULT_BRAND.nome,
    logoUrl: data.logo_url || null,
    corPrimaria: data.cor_primaria || DEFAULT_BRAND.corPrimaria,
    corSecundaria: data.cor_secundaria || DEFAULT_BRAND.corSecundaria,
    corDestaque: data.cor_destaque || data.cor_primaria || DEFAULT_BRAND.corDestaque,
  };
}

// Busca o branding da organização do usuário autenticado via RPC obter_branding_atual().
export async function fetchBrand(): Promise<Brand> {
  try {
    const data = await rpcCall<BrandingRow>('obter_branding_atual', {}, 12_000);
    if (!data) return DEFAULT_BRAND;
    return mapBrandingRow(data);
  } catch {
    return DEFAULT_BRAND;
  }
}

export async function fetchBrandByOrg(orgId: string): Promise<Brand> {
  try {
    const data = await rpcCall<BrandingRow>('obter_branding_por_organizacao', {
      p_org_id: orgId,
    }, 12_000);
    if (!data) return DEFAULT_BRAND;
    return mapBrandingRow(data);
  } catch {
    return DEFAULT_BRAND;
  }
}
