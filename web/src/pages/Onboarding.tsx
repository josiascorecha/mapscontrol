import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../components/Icon';
import { AuthShell } from '../components/Layout';
import { Alert, ErrorAlert, Field, useAction } from '../components/ui';
import { useSession } from '../session';

export function OnboardingPage() {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const [mode, setMode] = useState<'join' | 'create'>(me?.user.signupIntent === 'admin' ? 'create' : 'join');
  const [code, setCode] = useState('');
  const [cong, setCong] = useState({ name: '', city: '', state: '' });
  const { busy, error, run } = useAction();
  const canCreate = me?.user.signupIntent === 'admin' || me?.user.isGlobalAdmin;

  async function join(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api.post<{ congregationId: string }>('/join', { code }));
    if (r) {
      await refresh();
      nav(`/c/${r.congregationId}`, { replace: true });
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api.post<{ id: string }>('/congregations', { name: cong.name, city: cong.city || null, state: cong.state || null }));
    if (r) {
      await refresh();
      nav(`/c/${r.id}`, { replace: true });
    }
  }

  return (
    <AuthShell>
      <div className="brand"><Logo /><strong>MapsControl</strong></div>
      <div className="card">
        <h1>Olá, {me?.user.name.split(' ')[0]}!</h1>
        {me?.wasRevoked && <Alert kind="warn">Seu acesso à congregação foi encerrado pelo administrador. Para voltar, peça um novo código.</Alert>}
        {canCreate && (
          <div className="segmented" role="group" style={{ marginBottom: 16 }}>
            <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Nova congregação</button>
            <button type="button" aria-pressed={mode === 'join'} onClick={() => setMode('join')}>Tenho um código</button>
          </div>
        )}
        <ErrorAlert error={error} />
        {mode === 'join' ? (
          <form onSubmit={join}>
            <p>Digite o código que o administrador da sua congregação enviou para você.</p>
            <Field label="Código de acesso" hint="Exemplo: ABCD-EFGH-JKLM. Cada código funciona uma única vez.">
              <input
                className="input"
                style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}
                autoCapitalize="characters"
                autoComplete="one-time-code"
                spellCheck={false}
                maxLength={20}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <button className="btn block" disabled={busy}>{busy ? 'Verificando…' : 'Entrar na congregação'}</button>
          </form>
        ) : (
          <form onSubmit={create}>
            <p>Crie a congregação. Depois você cadastra territórios e quadras e gera códigos para os publicadores.</p>
            <Field label="Nome da congregação">
              <input className="input" required value={cong.name} onChange={(e) => setCong({ ...cong, name: e.target.value })} />
            </Field>
            <div className="grid2" style={{ gridTemplateColumns: '1fr 90px' }}>
              <Field label="Cidade">
                <input className="input" value={cong.city} onChange={(e) => setCong({ ...cong, city: e.target.value })} />
              </Field>
              <Field label="UF">
                <input className="input" maxLength={2} style={{ textTransform: 'uppercase' }} value={cong.state} onChange={(e) => setCong({ ...cong, state: e.target.value })} />
              </Field>
            </div>
            <button className="btn block" disabled={busy}>{busy ? 'Criando…' : 'Criar congregação'}</button>
          </form>
        )}
      </div>
      <p className="center" style={{ marginTop: 18 }}>
        <Link to="/conta">Minha conta</Link>
        {me?.user.isGlobalAdmin && <> · <Link to="/geral">Administração geral</Link></>}
      </p>
    </AuthShell>
  );
}

export function ConsentPage() {
  const { config, refresh } = useSession();
  const [accept, setAccept] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <AuthShell>
      <div className="brand"><Logo /><strong>MapsControl</strong></div>
      <div className="card">
        <h1>Termos atualizados</h1>
        <p>Os termos de uso ou a política de privacidade mudaram. Leia a nova versão para continuar.</p>
        <p><Link to="/termos" target="_blank">Termos de uso</Link> · <Link to="/privacidade" target="_blank">Política de privacidade</Link></p>
        <ErrorAlert error={error} />
        <label className="checkbox">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>Li e aceito a nova versão.</span>
        </label>
        <button
          className="btn block"
          disabled={!accept || busy}
          onClick={async () => {
            if (await run(() => api.post('/me/consent', { accept: true, termsVersion: config?.termsVersion, privacyVersion: config?.privacyVersion }))) await refresh();
          }}
        >
          Continuar
        </button>
        <p className="small muted" style={{ marginTop: 12 }}>
          Se não concordar, você pode <Link to="/conta">excluir sua conta</Link>.
        </p>
      </div>
    </AuthShell>
  );
}
