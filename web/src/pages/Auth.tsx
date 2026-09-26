import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Logo } from '../components/Icon';
import { AuthShell } from '../components/Layout';
import { Alert, ErrorAlert, Field, useAction } from '../components/ui';
import { useSession } from '../session';

function Brand() {
  return (
    <div className="brand">
      <Logo />
      <strong>MapsControl</strong>
    </div>
  );
}

function tokenFromHash(): string {
  const m = window.location.hash.match(/t=([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

export function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resent, setResent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setNeedsVerify(false);
    const ok = await run(async () => {
      try {
        await api.post('/auth/login', { email, password });
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') setNeedsVerify(true);
        throw err;
      }
    });
    if (ok) {
      await refresh();
      nav((loc.state as { from?: string } | null)?.from ?? '/', { replace: true });
    }
  }

  return (
    <AuthShell>
      <Brand />
      <div className="card">
        <h1>Entrar</h1>
        <form onSubmit={submit} noValidate>
          <ErrorAlert error={error} />
          {needsVerify && (
            <div className="stack" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className="btn secondary block"
                onClick={async () => {
                  await api.post('/auth/resend-verification', { email }).catch(() => {});
                  setResent(true);
                }}
              >
                Reenviar link de confirmação
              </button>
              {resent && <Alert kind="success">Se houver cadastro pendente, um novo link foi enviado.</Alert>}
            </div>
          )}
          <Field label="E-mail">
            <input className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Senha">
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="center" style={{ marginTop: 14 }}>
          <Link to="/esqueci-senha">Esqueci minha senha</Link>
        </p>
      </div>
      <p className="center" style={{ marginTop: 18 }}>
        Ainda não tem conta? <Link to="/cadastro"><b>Criar conta</b></Link>
      </p>
      <p className="center small muted">
        <Link to="/termos">Termos de uso</Link> · <Link to="/privacidade">Privacidade</Link>
      </p>
    </AuthShell>
  );
}

export function SignupPage() {
  const nav = useNavigate();
  const { config } = useSession();
  const [f, setF] = useState({ name: '', email: '', password: '', password2: '', intent: 'publisher' as 'publisher' | 'admin', accept: false });
  const { busy, error, run, setError } = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password !== f.password2) return setError(new ApiError(400, 'VALIDATION', 'As senhas não são iguais.'));
    if (!f.accept) return setError(new ApiError(400, 'VALIDATION', 'Para continuar, aceite os termos de uso e a política de privacidade.'));
    const ok = await run(() =>
      api.post('/auth/signup', {
        name: f.name,
        email: f.email,
        password: f.password,
        intent: f.intent,
        acceptTerms: true,
        termsVersion: config?.termsVersion,
        privacyVersion: config?.privacyVersion,
      }),
    );
    if (ok) nav('/verifique-email', { state: { email: f.email } });
  }

  return (
    <AuthShell>
      <Brand />
      <div className="card">
        <h1>Criar conta</h1>
        <form onSubmit={submit} noValidate>
          <ErrorAlert error={error} />
          <Field label="Eu sou" group>
            <div className="segmented" role="group" aria-label="Tipo de conta">
              <button type="button" aria-pressed={f.intent === 'publisher'} onClick={() => setF({ ...f, intent: 'publisher' })}>Publicador</button>
              <button type="button" aria-pressed={f.intent === 'admin'} onClick={() => setF({ ...f, intent: 'admin' })}>Administrador</button>
            </div>
            <small className="hint">
              {f.intent === 'publisher'
                ? 'Depois de confirmar o e-mail, você vai informar o código recebido do administrador.'
                : 'Depois de confirmar o e-mail, você vai criar a congregação e convidar os publicadores.'}
            </small>
          </Field>
          <Field label="Nome">
            <input className="input" autoComplete="name" required value={f.name} onChange={set('name')} />
          </Field>
          <Field label="E-mail">
            <input className="input" type="email" autoComplete="email" inputMode="email" required value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Senha" hint="Pelo menos 10 caracteres. Uma frase curta é fácil de lembrar.">
            <input className="input" type="password" autoComplete="new-password" required value={f.password} onChange={set('password')} />
          </Field>
          <Field label="Repita a senha">
            <input className="input" type="password" autoComplete="new-password" required value={f.password2} onChange={set('password2')} />
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={f.accept} onChange={(e) => setF({ ...f, accept: e.target.checked })} />
            <span>
              Li e aceito os <Link to="/termos" target="_blank">termos de uso</Link> e a{' '}
              <Link to="/privacidade" target="_blank">política de privacidade</Link>. Entendo que meu vínculo a uma congregação ficará registrado.
            </span>
          </label>
          <button className="btn block" disabled={busy || !config}>{busy ? 'Enviando…' : 'Criar conta'}</button>
        </form>
      </div>
      <p className="center" style={{ marginTop: 18 }}>
        Já tem conta? <Link to="/entrar"><b>Entrar</b></Link>
      </p>
    </AuthShell>
  );
}

export function CheckEmailPage() {
  const loc = useLocation();
  const email = (loc.state as { email?: string } | null)?.email ?? '';
  const [sent, setSent] = useState(false);
  return (
    <AuthShell>
      <Brand />
      <div className="card">
        <h1>Confira seu e-mail</h1>
        <p>
          Enviamos um link de confirmação{email ? <> para <b>{email}</b></> : ''}. Abra o e-mail e toque em <b>Confirmar e-mail</b>.
        </p>
        <p className="muted small">Não chegou? Veja a pasta de spam ou lixo eletrônico. O link vale por 24 horas.</p>
        {email && (
          <button
            className="btn secondary block"
            onClick={async () => {
              await api.post('/auth/resend-verification', { email }).catch(() => {});
              setSent(true);
            }}
          >
            Reenviar e-mail
          </button>
        )}
        {sent && <div style={{ marginTop: 12 }}><Alert kind="success">Pronto. Se o cadastro estiver pendente, um novo link foi enviado.</Alert></div>}
      </div>
      <p className="center" style={{ marginTop: 18 }}><Link to="/entrar">Voltar para entrar</Link></p>
    </AuthShell>
  );
}

export function ConfirmEmailPage() {
  const nav = useNavigate();
  const { refresh } = useSession();
  const [state, setState] = useState<'working' | 'error'>('working');
  const [err, setErr] = useState<unknown>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = tokenFromHash();
    history.replaceState(null, '', window.location.pathname); // remove o token da barra de endereço
    api
      .post('/auth/verify-email', { token })
      .then(async () => {
        await refresh();
        nav('/', { replace: true });
      })
      .catch((e) => {
        setErr(e);
        setState('error');
      });
  }, [nav, refresh]);
  return (
    <AuthShell>
      <Brand />
      <div className="card">
        {state === 'working' ? (
          <>
            <h1>Confirmando…</h1>
            <div className="spinner" />
          </>
        ) : (
          <>
            <h1>Não foi possível confirmar</h1>
            <ErrorAlert error={err} />
            <Link className="btn block" to="/entrar">Ir para entrar</Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <AuthShell>
      <Brand />
      <div className="card">
        <h1>Esqueci minha senha</h1>
        {done ? (
          <Alert kind="success">Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha. O link vale por 1 hora.</Alert>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => api.post('/auth/forgot-password', { email }))) setDone(true);
            }}
          >
            <ErrorAlert error={error} />
            <Field label="E-mail da conta">
              <input className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <button className="btn block" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button>
          </form>
        )}
      </div>
      <p className="center" style={{ marginTop: 18 }}><Link to="/entrar">Voltar para entrar</Link></p>
    </AuthShell>
  );
}

export function NewPasswordPage({ activation = false }: { activation?: boolean }) {
  const nav = useNavigate();
  const { refresh } = useSession();
  const [token] = useState(tokenFromHash);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const { busy, error, run, setError } = useAction();
  useEffect(() => {
    if (token) history.replaceState(null, '', window.location.pathname);
  }, [token]);
  return (
    <AuthShell>
      <Brand />
      <div className="card">
        <h1>{activation ? 'Defina sua senha' : 'Criar nova senha'}</h1>
        {!token ? (
          <Alert kind="error">Link incompleto. Abra novamente o link recebido por e-mail.</Alert>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (pw !== pw2) return setError(new ApiError(400, 'VALIDATION', 'As senhas não são iguais.'));
              if (await run(() => api.post('/auth/set-password', { token, password: pw }))) {
                await refresh();
                nav('/', { replace: true });
              }
            }}
          >
            <ErrorAlert error={error} />
            <Field label="Nova senha" hint="Pelo menos 10 caracteres.">
              <input className="input" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Field label="Repita a nova senha">
              <input className="input" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Field>
            <button className="btn block" disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha'}</button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
