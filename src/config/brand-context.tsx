import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DEFAULT_BRAND, fetchBrand, fetchBrandByOrg, type Brand } from './brand';

type BrandContextValue = {
  brand: Brand;
  reloadBrand: () => Promise<Brand>;
  reloadBrandForOrg: (orgId: string) => Promise<Brand>;
  resetBrand: () => void;
};

const BrandContext = createContext<BrandContextValue>({
  brand: DEFAULT_BRAND,
  reloadBrand: async () => DEFAULT_BRAND,
  reloadBrandForOrg: async () => DEFAULT_BRAND,
  resetBrand: () => undefined,
});

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);

  const reloadBrand = useCallback(async () => {
    const next = await fetchBrand().catch(() => DEFAULT_BRAND);
    setBrand(next);
    return next;
  }, []);

  const reloadBrandForOrg = useCallback(async (orgId: string) => {
    if (!orgId?.trim()) return reloadBrand();
    const next = await fetchBrandByOrg(orgId).catch(() => DEFAULT_BRAND);
    setBrand(next);
    return next;
  }, [reloadBrand]);

  const resetBrand = useCallback(() => setBrand(DEFAULT_BRAND), []);

  const value = useMemo(
    () => ({ brand, reloadBrand, reloadBrandForOrg, resetBrand }),
    [brand, reloadBrand, reloadBrandForOrg, resetBrand],
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext);
}
