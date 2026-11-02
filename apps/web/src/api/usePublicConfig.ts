import { useEffect, useState } from 'react';
import { api } from './client';

export interface PublicConfig {
  brand: { name: string; nameEn: string; product: string };
  banking: { mode: 'simulated' | 'http'; provider: string };
  verification: { smsMode: 'demo' | 'http'; faceMode: 'demo' | 'http' };
  auth?: { phoneVerifyRequired: boolean; loginMfa: boolean };
  demo: boolean;
}

/** 登录前也能读取的展示配置；不包含密钥或上游地址。 */
export function usePublicConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<PublicConfig>('/api/public/config')
      .then((value) => {
        if (!cancelled) setConfig(value);
      })
      .catch(() => {
        // 登录页保持安静降级，不阻塞表单
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
