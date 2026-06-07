import { rpcCall } from '../lib/supabase-rest';

export type ColetorModules = {
  inventario: boolean;
  patrimonio: boolean;
  validade: boolean;
  presenca: boolean;
};

export const DEFAULT_COLETOR_MODULES: ColetorModules = {
  inventario: true,
  patrimonio: false,
  validade: false,
  presenca: false,
};

export async function fetchColetorModules(): Promise<ColetorModules> {
  try {
    const data = await rpcCall<Record<string, boolean>>('obter_modulos_coletor', {}, 12_000);
    if (!data) return DEFAULT_COLETOR_MODULES;
    return {
      inventario: !!data.inventario,
      patrimonio: !!data.patrimonio,
      validade: !!data.validade,
      presenca: !!data.presenca,
    };
  } catch {
    return DEFAULT_COLETOR_MODULES;
  }
}
