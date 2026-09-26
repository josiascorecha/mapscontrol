import { Link } from 'react-router-dom';
import { Logo } from '../components/Icon';
import { Alert } from '../components/ui';
import { useSession } from '../session';
import { fmtDate } from '../util';

function DocShell({ title, version, children }: { title: string; version?: string; children: React.ReactNode }) {
  const { me } = useSession();
  return (
    <div className="auth-wrap" style={{ maxWidth: 720, justifyContent: 'flex-start' }}>
      <div className="brand"><Logo /><strong>MapsControl</strong></div>
      <div className="card doc">
        <h1>{title}</h1>
        {version && <p className="small muted">Versão {fmtDate(version)}</p>}
        <Alert kind="warn">Versão preliminar, sujeita a revisão jurídica antes do lançamento público.</Alert>
        {children}
      </div>
      <p className="center" style={{ marginTop: 16 }}>
        <Link to={me ? '/' : '/entrar'}>Voltar</Link> · <Link to="/termos">Termos</Link> · <Link to="/privacidade">Privacidade</Link> · <Link to="/excluir-conta">Excluir conta</Link>
      </p>
    </div>
  );
}

export function TermsPage() {
  const { config } = useSession();
  return (
    <DocShell title="Termos de uso" version={config?.termsVersion}>
      <h2>1. O que é o MapsControl</h2>
      <p>
        O MapsControl é uma ferramenta para organizar territórios, quadras e registros de visitas de congregações. Ele substitui o
        controle em papel. Não é um serviço oficial de nenhuma organização religiosa.
      </p>
      <h2>2. Contas e perfis</h2>
      <ul>
        <li><b>Publicador:</b> entra em uma congregação com um código individual fornecido pelo administrador e registra visitas.</li>
        <li><b>Administrador:</b> cria e gerencia a própria congregação, seus territórios, quadras, membros e códigos.</li>
        <li>Você é responsável por manter sua senha em sigilo e por não compartilhar sua conta.</li>
      </ul>
      <h2>3. Uso adequado</h2>
      <ul>
        <li>Registre somente informações operacionais (número da casa, data, tipo de visita, observações práticas).</li>
        <li><b>Não registre</b> nomes, telefones, documentos, crenças, opiniões, saúde ou outros dados pessoais de moradores.</li>
        <li>Não tente acessar dados de outras congregações nem burlar as permissões do sistema.</li>
        <li>O administrador pode revogar seu acesso a qualquer momento; o histórico que você registrou permanece com a congregação.</li>
      </ul>
      <h2>4. Disponibilidade</h2>
      <p>
        O serviço é oferecido “no estado em que se encontra”, sem garantia de disponibilidade contínua. O aplicativo precisa de internet
        para salvar registros; nada é salvo sem conexão.
      </p>
      <h2>5. Encerramento</h2>
      <p>Você pode excluir sua conta a qualquer momento em Conta › Excluir conta, no aplicativo ou no site.</p>
      <h2>6. Contato</h2>
      <p>Dúvidas: {config?.contactEmail ?? '—'}.</p>
    </DocShell>
  );
}

export function PrivacyPage() {
  const { config } = useSession();
  return (
    <DocShell title="Política de privacidade" version={config?.privacyVersion}>
      <h2>1. Por que esta política é importante</h2>
      <p>
        Saber que uma pessoa participa de uma congregação pode revelar sua convicção religiosa, que a Lei Geral de Proteção de Dados
        (LGPD, Lei 13.709/2018) trata como <b>dado pessoal sensível</b>. Por isso coletamos o mínimo possível e pedimos seu consentimento
        específico e destacado no cadastro.
      </p>
      <h2>2. Quais dados coletamos</h2>
      <table className="simple">
        <thead><tr><th>Dado</th><th>Para quê</th></tr></thead>
        <tbody>
          <tr><td>Nome e e-mail</td><td>Identificar sua conta, confirmar o e-mail, recuperar a senha e mostrar quem fez cada registro.</td></tr>
          <tr><td>Senha (guardada só como hash Argon2id)</td><td>Autenticação. Ninguém, nem os administradores, consegue ver sua senha.</td></tr>
          <tr><td>Vínculo com a congregação e perfil</td><td>Liberar o acesso somente aos dados da sua congregação.</td></tr>
          <tr><td>Registros de visita (casa/apartamento, data, tipo, observação, autor)</td><td>Organizar o trabalho nos territórios.</td></tr>
          <tr><td>Aceite dos termos (versão e data)</td><td>Comprovar o consentimento.</td></tr>
          <tr><td>Registro de atividades (auditoria) e cookie de sessão</td><td>Segurança, correção de erros e prevenção de abuso. O endereço IP é usado apenas de forma transitória, como hash, para limitar tentativas.</td></tr>
        </tbody>
      </table>
      <p>Não coletamos localização do aparelho, contatos, fotos nem dados de moradores. Não usamos publicidade nem rastreadores.</p>
      <h2>3. Base legal</h2>
      <p>
        Consentimento específico e destacado do titular para o dado sensível (LGPD art. 11, I) e execução do serviço solicitado. Você
        pode revogar o consentimento excluindo sua conta.
      </p>
      <h2>4. Quem acessa</h2>
      <ul>
        <li>Administradores da sua congregação: seu nome, e-mail e os registros da congregação.</li>
        <li>Publicadores da sua congregação: seu nome como autor dos registros.</li>
        <li>Administrador Geral do aplicativo: acesso de suporte a todas as congregações, com todas as ações registradas em auditoria.</li>
        <li>Prestadores: provedor de hospedagem (servidor VPS) e provedor de envio de e-mails. Não vendemos nem compartilhamos dados para outros fins.</li>
        <li>Mapas: as imagens do mapa são carregadas do OpenStreetMap, que recebe o endereço IP do seu aparelho ao exibir o mapa.</li>
      </ul>
      <h2>5. Retenção e exclusão</h2>
      <ul>
        <li>Conta: enquanto estiver ativa. Ao excluir, nome, e-mail e senha são apagados imediatamente; registros feitos por você permanecem para a congregação como “Usuário removido”.</li>
        <li>Sessões expiram após 30 dias sem uso. Links de e-mail expiram em 1 a 72 horas.</li>
        <li>Registro de auditoria: 2 anos. Cópias de segurança: até 30 dias.</li>
      </ul>
      <h2>6. Seus direitos</h2>
      <p>
        Você pode confirmar a existência de tratamento, acessar, corrigir (Conta › Nome), excluir (Conta › Excluir conta) e revogar o
        consentimento. Para outros pedidos, escreva para {config?.contactEmail ?? '—'}.
      </p>
      <h2>7. Segurança</h2>
      <p>Conexão criptografada (HTTPS), senhas com hash, isolamento entre congregações, controle de permissões no servidor e cópias de segurança.</p>
    </DocShell>
  );
}

export function DeleteInfoPage() {
  const { me, config } = useSession();
  return (
    <DocShell title="Como excluir sua conta">
      <ol>
        <li>Entre no MapsControl (aplicativo ou site).</li>
        <li>Toque em <b>Conta</b> e depois em <b>Excluir minha conta</b>.</li>
        <li>Confirme com sua senha e a palavra EXCLUIR.</li>
      </ol>
      <p>
        Apagamos imediatamente seu nome, e-mail e senha e encerramos suas sessões. Registros de visita que você fez continuam para a
        congregação, sem sua identificação. Cópias de segurança são descartadas em até 30 dias.
      </p>
      <p>Se não conseguir entrar, escreva para {config?.contactEmail ?? '—'} a partir do e-mail cadastrado.</p>
      {me && <Link className="btn block" to="/conta">Ir para minha conta</Link>}
    </DocShell>
  );
}
