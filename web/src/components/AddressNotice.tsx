import { useSession } from '../session';
import { Icon } from './Icon';

/** "2026-10-23" → "23/10/2026" */
export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Dados da mudança quando há mudança de domínio configurada e a pessoa está no endereço antigo. */
export function useOldAddress(): { newOrigin: string; newHost: string; date: string } | null {
  const { config } = useSession();
  if (!config?.appOrigin || !config.addressChangeDate) return null;
  if (window.location.origin === config.appOrigin) return null;
  let newHost: string;
  try {
    newHost = new URL(config.appOrigin).host;
  } catch {
    return null;
  }
  return { newOrigin: config.appOrigin, newHost, date: formatDateBR(config.addressChangeDate) };
}

/** true no endereço novo enquanto a mudança está em andamento (ajuda quem chega pelo aviso). */
export function useIsNewAddress(): boolean {
  const { config } = useSession();
  return !!config?.addressChangeDate && window.location.origin === config.appOrigin;
}

/**
 * Aviso para quem ainda abre o sistema pelo endereço antigo.
 * Login e app instalado ficam presos ao endereço (cookies e PWA são por domínio),
 * por isso o aviso explica que é preciso entrar de novo e reinstalar.
 */
export function AddressNotice() {
  const old = useOldAddress();
  if (!old) return null;
  const { pathname, search, hash } = window.location;
  return (
    <section className="address-notice" aria-label="Mudança de endereço">
      <Icon name="info" />
      <div>
        <p>
          <strong>O MapsControl tem um novo endereço: {old.newHost}</strong>
        </p>
        <p>
          A partir de {old.date}, este endereço vai levar você automaticamente para o novo. Lá, entre com o mesmo e-mail e senha. Se
          você instalou o app no celular, instale de novo pelo novo endereço.
        </p>
        <a className="btn" href={`${old.newOrigin}${pathname}${search}${hash}`}>
          Abrir novo endereço
        </a>
      </div>
    </section>
  );
}
