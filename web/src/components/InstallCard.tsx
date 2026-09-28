import { useEffect, useState } from 'react';
import { canPromptInstall, isStandalone, onInstallChange, platform, promptInstall } from '../install';
import { Logo } from './Icon';

const KEY = 'mc-install-dismissed';
const dismissed = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * Convite para instalar o MapsControl como app (PWA).
 * - Android/Chrome e computador: botão "Instalar" abre o diálogo do navegador.
 * - iPhone: mostra o passo a passo (Compartilhar → Adicionar à Tela de Início).
 * variant="banner" pode ser dispensado; variant="section" (tela Conta) sempre aparece.
 */
export function InstallCard({ variant = 'banner' }: { variant?: 'banner' | 'section' }) {
  const [, force] = useState(0);
  const [hidden, setHidden] = useState(() => variant === 'banner' && dismissed());
  const [help, setHelp] = useState(false);
  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);

  if (isStandalone() || hidden) return null;
  const p = platform();
  const canPrompt = canPromptInstall();

  const steps =
    p === 'ios' ? (
      <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
        <li>Abra este site no <b>Safari</b>.</li>
        <li>Toque no botão <b>Compartilhar</b> (quadrado com seta para cima).</li>
        <li>Escolha <b>Adicionar à Tela de Início</b> e confirme.</li>
      </ol>
    ) : (
      <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
        <li>Abra este site no <b>Chrome</b>.</li>
        <li>Toque no menu <b>⋮</b> (três pontinhos, no canto de cima).</li>
        <li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b> e confirme.</li>
      </ol>
    );

  return (
    <div className="card install-card" style={{ marginBottom: 14 }}>
      <div className="row nowrap" style={{ alignItems: 'flex-start' }}>
        <span style={{ width: 44, height: 44, flex: 'none' }} className="install-logo">
          <Logo />
        </span>
        <div className="grow">
          <strong style={{ display: 'block' }}>{variant === 'section' ? 'Instalar no celular' : 'Instale o MapsControl no celular'}</strong>
          <span className="small muted">Fica um ícone na tela inicial e abre com um toque, em tela cheia. Continua precisando de internet para salvar.</span>
          {(help || (!canPrompt && variant === 'section')) && steps}
        </div>
      </div>
      <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
        {variant === 'banner' && (
          <button
            className="btn ghost small"
            onClick={() => {
              try {
                localStorage.setItem(KEY, '1');
              } catch {
                /* ignora */
              }
              setHidden(true);
            }}
          >
            Agora não
          </button>
        )}
        {canPrompt ? (
          <button className="btn small" onClick={() => void promptInstall()}>
            Instalar
          </button>
        ) : (
          !(variant === 'section') && (
            <button className="btn secondary small" onClick={() => setHelp((h) => !h)}>
              {help ? 'Ocultar passos' : 'Como instalar'}
            </button>
          )
        )}
      </div>
    </div>
  );
}
