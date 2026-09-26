import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoadError, ToastProvider } from './components/ui';
import { AccountPage, DeletedPage } from './pages/Account';
import { CheckEmailPage, ConfirmEmailPage, ForgotPage, LoginPage, NewPasswordPage, SignupPage } from './pages/Auth';
import { HomePage, TerritoryPage } from './pages/Congregation';
import { AddressPage, BlockPage } from './pages/Field';
import { DeleteInfoPage, PrivacyPage, TermsPage } from './pages/Legal';
import { AdminPage, BuildingsPage, GlobalPage } from './pages/Manage';
import { ConsentPage, OnboardingPage } from './pages/Onboarding';
import { SessionProvider, useSession } from './session';

function Protected({ children, allowNoConsent = false }: { children: ReactNode; allowNoConsent?: boolean }) {
  const { me, loading, error } = useSession();
  const loc = useLocation();
  if (loading) return <div className="spinner" style={{ marginTop: '40vh' }} aria-label="Carregando" />;
  if (!me && error) return <div className="auth-wrap"><LoadError error={error} onRetry={() => window.location.reload()} /></div>;
  if (!me) return <Navigate to="/entrar" replace state={{ from: loc.pathname }} />;
  if (me.needsConsent && !allowNoConsent) return <ConsentPage />;
  return <>{children}</>;
}

function Root() {
  const { me } = useSession();
  if (!me) return null;
  if (me.membership) return <Navigate to={`/c/${me.membership.congregation.id}`} replace />;
  if (me.user.isGlobalAdmin) return <Navigate to="/geral" replace />;
  return <Navigate to="/inicio" replace />;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  if (loading) return <div className="spinner" style={{ marginTop: '40vh' }} />;
  if (me) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <SessionProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/entrar" element={<PublicOnly><LoginPage /></PublicOnly>} />
            <Route path="/cadastro" element={<PublicOnly><SignupPage /></PublicOnly>} />
            <Route path="/verifique-email" element={<CheckEmailPage />} />
            <Route path="/confirmar-email" element={<ConfirmEmailPage />} />
            <Route path="/esqueci-senha" element={<ForgotPage />} />
            <Route path="/nova-senha" element={<NewPasswordPage />} />
            <Route path="/termos" element={<TermsPage />} />
            <Route path="/privacidade" element={<PrivacyPage />} />
            <Route path="/excluir-conta" element={<DeleteInfoPage />} />
            <Route path="/conta-excluida" element={<DeletedPage />} />

            <Route path="/" element={<Protected><Root /></Protected>} />
            <Route path="/inicio" element={<Protected><OnboardingPage /></Protected>} />
            <Route path="/conta" element={<Protected allowNoConsent><AccountPage /></Protected>} />
            <Route path="/geral" element={<Protected><GlobalPage /></Protected>} />
            <Route path="/c/:cid" element={<Protected><HomePage /></Protected>} />
            <Route path="/c/:cid/t/:tid" element={<Protected><TerritoryPage /></Protected>} />
            <Route path="/c/:cid/q/:bid" element={<Protected><BlockPage /></Protected>} />
            <Route path="/c/:cid/e/:aid" element={<Protected><AddressPage /></Protected>} />
            <Route path="/c/:cid/predios" element={<Protected><BuildingsPage /></Protected>} />
            <Route path="/c/:cid/admin" element={<Protected><AdminPage /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  );
}
