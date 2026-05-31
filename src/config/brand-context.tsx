import React, { createContext, useContext, useMemo, useState } from 'react';
import { DEFAULT_BRAND, fetchBrand, type Brand } from './brand';

type BrandContextValue = {
  brand: Brand;
  reloadBrand: () => Promise<Brand>;
  resetBrand: () => void;
};

const BrandContext = createContext<BrandContextValue>({
  brand: DEFAULT_BRAND,
  reloadBrand: async () => DEFAULT_BRAND,
  resetBrand: () => undefined,
});

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);

  const reloadBrand = async () => {
    const next = await fetchBrand().catch(() => DEFAULT_BRAND);
    setBrand(next);
    return next;
  };

  const resetBrand = () => setBrand(DEFAULT_BRAND);

  const value = useMemo(
    () => ({ brand, reloadBrand, resetBrand }),
    [brand],
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  return useContext(BrandContext);
}
