import { lookup as dnsLookup } from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Resolução segura de links do Google Maps.
 *
 * 1. Se o link já contém coordenadas, extrai sem acesso à rede.
 * 2. Se for link curto (maps.app.goo.gl / goo.gl/maps), segue redirecionamentos
 *    manualmente: no máximo MAX_REDIRECTS, apenas HTTPS, apenas domínios
 *    permitidos, e a conexão recusa IPs internos (proteção contra SSRF,
 *    inclusive DNS rebinding, pois a checagem é feita no momento da conexão).
 * 3. Sem coordenadas, retorna resolved=false: a interface pede posicionamento
 *    manual. Nunca inventa coordenadas.
 */

export const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 6000;

const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);

export function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (SHORT_HOSTS.has(h)) return true;
  if (h === 'maps.google.com') return true;
  // google.com, www.google.com, google.com.br, www.google.com.br, maps.google.com.br
  return /^(www\.|maps\.)?google\.(com|com\.br)$/.test(h);
}

export interface Coords {
  lat: number;
  lng: number;
}

function valid(lat: number, lng: number): Coords | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

/** Extrai coordenadas das formas de URL conhecidas do Google Maps. */
export function extractCoords(rawUrl: string): Coords | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const decoded = decodeURIComponent(url.pathname + url.search).replace(/\+/g, ' ');
  // Marcador do lugar (!3d lat !4d lng) é mais preciso que o centro da tela (@).
  const pin = decoded.match(new RegExp(`!3d${NUM}!4d${NUM}`));
  if (pin) return valid(Number(pin[1]), Number(pin[2]));
  const search = decoded.match(new RegExp(`/(?:search|place|dir)/${NUM},\\s*${NUM}`));
  if (search) return valid(Number(search[1]), Number(search[2]));
  for (const key of ['q', 'query', 'll', 'destination', 'center']) {
    const v = url.searchParams.get(key);
    const m = v?.match(new RegExp(`^\\s*${NUM},\\s*${NUM}\\s*$`));
    if (m) return valid(Number(m[1]), Number(m[2]));
  }
  const at = decoded.match(new RegExp(`@${NUM},${NUM}`));
  if (at) return valid(Number(at[1]), Number(at[2]));
  return null;
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return true;
}

/** Agente que valida o IP de destino no momento da conexão. */
export function safeAgent(): Agent {
  return new Agent({
    connect: {
      timeout: TIMEOUT_MS,
      lookup(hostname, options, cb) {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return cb(err, '', 4);
          const list = addresses as unknown as { address: string; family: number }[];
          const bad = list.find((a) => isPrivateAddress(a.address));
          if (bad || list.length === 0) return cb(new Error('Destino não permitido'), '', 4);
          // undici espera a forma "all" quando solicitada
          if ((options as { all?: boolean }).all) return (cb as any)(null, list);
          cb(null, list[0].address, list[0].family);
        });
      },
    },
  });
}

export type Fetcher = (url: string) => Promise<{ status: number; location: string | null }>;

let sharedAgent: Agent | null = null;

export const defaultFetcher: Fetcher = async (url) => {
  sharedAgent ??= safeAgent();
  const res = await undiciFetch(url, {
    method: 'GET',
    redirect: 'manual',
    dispatcher: sharedAgent,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'MapsControl/1.0 (+resolucao-de-link)', accept: 'text/html' },
  });
  // Não lemos o corpo: só interessa o cabeçalho Location.
  await res.body?.cancel().catch(() => {});
  return { status: res.status, location: res.headers.get('location') };
};

export type ResolveResult =
  | { resolved: true; lat: number; lng: number; finalUrl: string }
  | { resolved: false; reason: 'invalid_url' | 'domain_not_allowed' | 'no_coordinates' | 'too_many_redirects' | 'network_error' };

export async function resolveMapsLink(input: string, fetcher: Fetcher = defaultFetcher): Promise<ResolveResult> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { resolved: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    return { resolved: false, reason: 'invalid_url' };
  }
  if (!isAllowedHost(url.hostname)) return { resolved: false, reason: 'domain_not_allowed' };
  if (url.hostname === 'goo.gl' && !url.pathname.startsWith('/maps')) {
    return { resolved: false, reason: 'domain_not_allowed' };
  }

  let current = url.toString();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const direct = extractCoords(current);
    if (direct) return { resolved: true, ...direct, finalUrl: current };
    const host = new URL(current).hostname;
    // Só fazemos requisição de rede para encurtadores; páginas completas do
    // Google sem coordenadas na URL exigiriam executar JavaScript.
    if (!SHORT_HOSTS.has(host)) return { resolved: false, reason: 'no_coordinates' };
    if (hop === MAX_REDIRECTS) break;
    let res;
    try {
      res = await fetcher(current);
    } catch {
      return { resolved: false, reason: 'network_error' };
    }
    if (res.status < 300 || res.status > 399 || !res.location) return { resolved: false, reason: 'no_coordinates' };
    let next: URL;
    try {
      next = new URL(res.location, current);
    } catch {
      return { resolved: false, reason: 'invalid_url' };
    }
    if (next.protocol !== 'https:' || !isAllowedHost(next.hostname)) {
      return { resolved: false, reason: 'domain_not_allowed' };
    }
    current = next.toString();
  }
  return { resolved: false, reason: 'too_many_redirects' };
}

export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
