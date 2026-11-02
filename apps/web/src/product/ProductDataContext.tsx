import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import type { OverviewPayload } from '@bank/shared';
import { api } from '../api/client';

interface ProductDataContextValue {
  overview: OverviewPayload | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ProductDataContext = createContext<ProductDataContextValue | null>(null);

export function ProductDataProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<OverviewPayload>('/api/overview');
      setOverview(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, location.pathname]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refresh();
    }, 25_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const value = useMemo(
    () => ({ overview, loading, error, refresh }),
    [overview, loading, error, refresh],
  );

  return <ProductDataContext.Provider value={value}>{children}</ProductDataContext.Provider>;
}

export function useProductData(): ProductDataContextValue {
  const context = useContext(ProductDataContext);
  if (!context) throw new Error('useProductData must be used inside ProductDataProvider');
  return context;
}
