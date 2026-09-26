import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type AppConfig, type Me } from './api';

interface SessionState {
  me: Me | null;
  config: AppConfig | null;
  loading: boolean;
  error: unknown;
  refresh: () => Promise<Me | null>;
  clear: () => void;
}

const Ctx = createContext<SessionState>(null as unknown as SessionState);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>('/me');
      setMe(m);
      setError(null);
      return m;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setError(null);
      } else setError(e);
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setConfig(await api.get<AppConfig>('/config'));
      } catch (e) {
        setError(e);
      }
      await refresh();
      setLoading(false);
    })();
    const onUnauth = () => setMe(null);
    window.addEventListener('mc:unauthenticated', onUnauth);
    return () => window.removeEventListener('mc:unauthenticated', onUnauth);
  }, [refresh]);

  return <Ctx.Provider value={{ me, config, loading, error, refresh, clear: () => setMe(null) }}>{children}</Ctx.Provider>;
}
