import { useEffect, useState } from 'react';

/**
 * 只做“设备是否联网”的判断：接口数据不在离线缓存里，
 * 因此断网时必须显式告诉用户当前看到的是上一次加载的内容。
 */
export function useOnlineStatus(): { online: boolean; wentOfflineAt: number | null } {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [wentOfflineAt, setWentOfflineAt] = useState<number | null>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? Date.now() : null,
  );

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      setWentOfflineAt(null);
    };
    const goOffline = () => {
      setOnline(false);
      setWentOfflineAt(Date.now());
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return { online, wentOfflineAt };
}
