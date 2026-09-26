export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'OFFLINE', 'Sem conexão com o servidor. O que você digitou continua na tela: tente de novo quando a internet voltar.');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* resposta sem corpo JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('mc:unauthenticated'));
    throw new ApiError(res.status, data?.error ?? 'ERROR', data?.message ?? 'Algo deu errado. Tente novamente.');
  }
  return data as T;
}

export const api = {
  get: <T,>(p: string) => request<T>('GET', p),
  post: <T,>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T,>(p: string, b: unknown) => request<T>('PATCH', p, b),
  del: <T,>(p: string) => request<T>('DELETE', p),
};

// ---------- Tipos ----------
export type Status = 'pending' | 'letter' | 'contacted';
export interface Counts { pending: number; letter: number; contacted: number; total: number }
export interface Me {
  user: { id: string; name: string; email: string; isGlobalAdmin: boolean; signupIntent: 'publisher' | 'admin' };
  membership: null | { id: string; role: 'publisher' | 'admin'; congregation: { id: string; name: string; city: string | null; state: string | null } };
  wasRevoked: boolean;
  needsConsent: boolean;
}
export interface AppConfig { termsVersion: string; privacyVersion: string; tileUrl: string; tileAttribution: string; contactEmail: string }
export interface Territory extends Partial<Counts> { id: string; number: number; name: string | null; notes: string | null; blocks?: number }
export interface Block extends Partial<Counts> {
  id: string; number: number; name: string | null; maps_url: string | null; lat: number | null; lng: number | null;
  googleMapsUrl: string | null; buildings?: number;
}
export interface AddressRow extends Partial<Counts> {
  id: string; kind: 'house' | 'building'; number: string; street: string | null; name: string | null; notes: string | null;
  status: Status | null; last_contact_on: string | null; last_letter_on: string | null; last_absent_on: string | null;
}
export interface Unit { id: string; tower: string; identifier: string; status: Status; last_contact_on: string | null; last_letter_on: string | null; last_absent_on: string | null }
export interface VisitRecord {
  id: string; action: 'contact' | 'letter' | 'absent'; occurred_on: string; note: string | null; created_at: string;
  voided_at: string | null; void_reason: string | null; author_name: string | null; canVoid: boolean;
}
