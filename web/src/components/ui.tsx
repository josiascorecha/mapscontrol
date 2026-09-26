import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ApiError, type Status } from '../api';
import { STATUS_LABEL } from '../util';
import { Icon } from './Icon';

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'success' | 'warn'; children: ReactNode }) {
  const icon = kind === 'error' || kind === 'warn' ? 'alert' : kind === 'success' ? 'check' : 'info';
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : 'Algo deu errado. Tente novamente.';
  return <Alert kind={error instanceof ApiError && error.offline ? 'warn' : 'error'}>{msg}</Alert>;
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="card center">
      <ErrorAlert error={error} />
      <button className="btn secondary" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`chip ${status}`}>
      <span className={`dot ${status}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Campo com rótulo associado por id; a dica fica em aria-describedby (não entra no nome acessível).
 * Use group=true quando o conteúdo for um grupo de botões.
 */
export function Field({ label, hint, group, children }: { label: string; hint?: string; group?: boolean; children: ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  if (group) {
    return (
      <div className="field" role="group" aria-labelledby={`${id}-label`} aria-describedby={hintId}>
        <span id={`${id}-label`}>{label}</span>
        {children}
        {hint && <small className="hint" id={hintId}>{hint}</small>}
      </div>
    );
  }
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, 'aria-describedby': hintId })
    : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {child}
      {hint && <small className="hint" id={hintId}>{hint}</small>}
    </div>
  );
}

export function Stats({ c }: { c: { pending?: number; letter?: number; contacted?: number; total?: number } }) {
  const total = c.total ?? 0;
  const pct = (n = 0) => (total ? `${(n / total) * 100}%` : '0');
  return (
    <>
      <div className="stats">
        <div className="stat"><b>{c.pending ?? 0}</b><span>Pendentes</span></div>
        <div className="stat letter"><b>{c.letter ?? 0}</b><span>Com carta</span></div>
        <div className="stat contacted"><b>{c.contacted ?? 0}</b><span>Contatos</span></div>
      </div>
      <div className="bar" aria-hidden="true">
        <i className="contacted" style={{ width: pct(c.contacted) }} />
        <i className="letter" style={{ width: pct(c.letter) }} />
      </div>
    </>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    ref.current?.focus(); // foco só ao abrir
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="grabber" />
        <div className="row nowrap" style={{ marginBottom: 8 }}>
          <h2 className="grow" style={{ margin: 0 }}>{title}</h2>
          <button className="btn ghost small" onClick={onClose}>Fechar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Aviso de sucesso (só aparece após confirmação do servidor) ----------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status" aria-live="polite">
          <Icon name="check" /> {msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Carrega dados com estados de carregamento/erro e recarga manual. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

/** Executa uma ação assíncrona controlando "salvando" e erro. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}
