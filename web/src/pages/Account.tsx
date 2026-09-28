import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Icon } from '../components/Icon';
import { InstallCard } from '../components/InstallCard';
import { Layout } from '../components/Layout';
import { Alert, ErrorAlert, Field, useAction, useToast } from '../components/ui';
import { useSession } from '../session';
import { getTheme, setTheme, type Theme } from '../theme';

export function AccountPage() {
  const { me, refresh, clear } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(me?.user.name ?? '');
  const [pw, setPw] = useState({ current: '', next: '', next2: '' });
  const [del, setDel] = useState({ password: '', confirm: '' });
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const saveName = useAction();
  const savePw = useAction();
  const delAcc = useAction();
  const logout = useAction();
  if (!me) return null;
  const m = me.membership;

  return (
    <Layout title="Minha conta" subtitle={me.user.email} isAdmin={m?.role === 'admin'}>
      <div className="card">
        <h2>Perfil</h2>
        <p className="small muted" style={{ marginBottom: 12 }}>
          {m ? <>Congregação: <b>{m.congregation.name}</b> · {m.role === 'admin' ? 'Administrador' : 'Publicador'}</> : 'Sem congregação no momento.'}
          {me.user.isGlobalAdmin && <> · <b>Administrador Geral</b></>}
        </p>
        <ErrorAlert error={saveName.error} />
        <Field label="Nome">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button
          className="btn secondary block"
          disabled={saveName.busy || name === me.user.name}
          onClick={async () => {
            if (await saveName.run(() => api.patch('/me', { name }))) {
              await refresh();
              toast('Nome atualizado');
            }
          }}
        >
          Salvar nome
        </button>
      </div>

      <InstallCard variant="section" />

      <div className="card">
        <h2>Aparência</h2>
        <div className="segmented" role="group" aria-label="Tema" style={{ ['--n' as string]: 3 }}>
          {(
            [
              ['auto', 'Automático'],
              ['light', 'Claro'],
              ['dark', 'Escuro'],
            ] as [Theme, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              aria-pressed={theme === k}
              onClick={() => {
                setTheme(k);
                setThemeState(k);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>“Automático” segue a configuração do celular ou computador. Vale só para este aparelho.</p>
      </div>

      <div className="card">
        <h2>Trocar senha</h2>
        <ErrorAlert error={savePw.error} />
        <Field label="Senha atual"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="Nova senha" hint="Pelo menos 6 caracteres, com letras e números."><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <Field label="Repita a nova senha"><input className="input" type="password" autoComplete="new-password" value={pw.next2} onChange={(e) => setPw({ ...pw, next2: e.target.value })} /></Field>
        <button
          className="btn secondary block"
          disabled={savePw.busy || !pw.current || !pw.next}
          onClick={async () => {
            if (pw.next !== pw.next2) return savePw.setError(new ApiError(400, 'VALIDATION', 'As senhas novas não são iguais.'));
            if (await savePw.run(() => api.post('/me/password', { current: pw.current, password: pw.next }))) {
              setPw({ current: '', next: '', next2: '' });
              toast('Senha alterada. Os outros aparelhos foram desconectados.');
            }
          }}
        >
          Alterar senha
        </button>
      </div>

      <div className="card">
        <ErrorAlert error={logout.error} />
        <button
          className="btn secondary block"
          disabled={logout.busy}
          onClick={async () => {
            if (await logout.run(() => api.post('/auth/logout'))) {
              clear();
              nav('/entrar', { replace: true });
            }
          }}
        >
          <Icon name="logout" /> Sair deste aparelho
        </button>
        <p className="center small" style={{ margin: '12px 0 0' }}>
          <Link to="/termos">Termos de uso</Link> · <Link to="/privacidade">Política de privacidade</Link>
        </p>
      </div>

      <div className="card" style={{ borderColor: 'var(--danger-700)' }}>
        <h2>Excluir minha conta</h2>
        <p className="small">
          Seu nome, e-mail e senha são apagados na hora e você sai de todos os aparelhos. Os registros de visita que você fez ficam para a
          congregação, sem sua identificação. Não é possível desfazer.
        </p>
        <ErrorAlert error={delAcc.error} />
        <Field label="Senha"><input className="input" type="password" autoComplete="current-password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} /></Field>
        <Field label="Digite EXCLUIR para confirmar"><input className="input" value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} /></Field>
        <button
          className="btn danger block"
          disabled={delAcc.busy || del.confirm !== 'EXCLUIR' || !del.password}
          onClick={async () => {
            if (await delAcc.run(() => api.post('/me/delete', del))) {
              clear();
              nav('/conta-excluida', { replace: true });
            }
          }}
        >
          Excluir minha conta
        </button>
      </div>
    </Layout>
  );
}

export function DeletedPage() {
  return (
    <div className="auth-wrap">
      <div className="card center">
        <h1>Conta excluída</h1>
        <Alert kind="success">Seus dados de conta foram apagados.</Alert>
        <Link className="btn block" to="/entrar">Voltar ao início</Link>
      </div>
    </div>
  );
}
