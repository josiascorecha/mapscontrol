import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useSession } from '../session';
import { Icon } from './Icon';
import { useOnline } from './ui';

interface Props {
  title: string;
  subtitle?: string;
  cid?: string;
  back?: string | true;
  isAdmin?: boolean;
  viaGlobal?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}

export function Layout({ title, subtitle, cid, back, isAdmin, viaGlobal, actions, children }: Props) {
  const nav = useNavigate();
  const online = useOnline();
  const { me } = useSession();
  const home = cid ?? me?.membership?.congregation.id;
  const items = home
    ? [
        { to: `/c/${home}`, icon: 'home' as const, label: 'Início', end: true },
        { to: `/c/${home}/predios`, icon: 'building' as const, label: 'Prédios' },
        ...(isAdmin ? [{ to: `/c/${home}/admin`, icon: 'users' as const, label: 'Gerenciar' }] : []),
        ...(me?.user.isGlobalAdmin ? [{ to: '/geral', icon: 'shield' as const, label: 'Geral' }] : []),
        { to: '/conta', icon: 'user' as const, label: 'Conta' },
      ]
    : [
        ...(me?.user.isGlobalAdmin ? [{ to: '/geral', icon: 'shield' as const, label: 'Geral' }] : []),
        { to: '/conta', icon: 'user' as const, label: 'Conta' },
      ];

  return (
    <div className="app">
      <header className="topbar">
        {back && (
          <button className="icon-btn" aria-label="Voltar" onClick={() => (back === true ? nav(-1) : nav(back))}>
            <Icon name="back" />
          </button>
        )}
        <div className="title">
          <strong>{title}</strong>
          {subtitle && <small>{subtitle}</small>}
        </div>
        {actions}
      </header>
      {!online && (
        <div className="offline-banner" role="status">
          Sem internet. Nada será salvo até a conexão voltar.
        </div>
      )}
      {viaGlobal && (
        <div className="global-banner">
          Você está vendo esta congregação como Administrador Geral. Suas ações ficam registradas. <Link to="/geral">Trocar</Link>
        </div>
      )}
      <main>{children}</main>
      <nav className="bottomnav" style={{ ['--cols' as string]: items.length }} aria-label="Navegação principal">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end}>
            <Icon name={i.icon} />
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  const online = useOnline();
  return (
    <>
      {!online && <div className="offline-banner" style={{ top: 0 }}>Sem internet no momento.</div>}
      <div className="auth-wrap">{children}</div>
    </>
  );
}
