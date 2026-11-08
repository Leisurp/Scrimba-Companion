import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/** `null` while unknown. `isInternetReachable` can be null on some platforms; treat as online. */
export function useConnectivity(): { online: boolean | null } {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    return NetInfo.addEventListener((s) => {
      if (s.isConnected === null) return;
      setOnline(!!s.isConnected && s.isInternetReachable !== false);
    });
  }, []);
  return { online };
}
