import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Layout } from '../components/Layout';
import { Alert, ErrorAlert, Field, Loading, LoadError, Sheet, useAction, useLoad, useToast } from '../components/ui';
import { useSession } from '../session';
import { fmtDate, fmtDateTime, unitLabel } from '../util';
import { useCong } from './Congregation';

// ---------------- Prédios e cartas ----------------
interface BuildingRow {
  id: string; number: string; street: string | null; name: string | null; block_id: string; block_number: number;
  territory_id: string; territory_number: number; pending: number; letter: number; contacted: number; total: number;
  letter_units: { id: string; tower: string; identifier: string; lastLetterOn: string }[];
}
interface LetterHouse { id: string; number: string; street: string | null; last_letter_on: string; block_id: string; block_number: number; territory_number: number }

export function BuildingsPage() {
  const { cid = '' } = useParams();
  const cong = useCong(cid);
  const [onlyLetters, setOnlyLetters] = useState(false);
  const d = useLoad(() => api.get<{ buildings: BuildingRow[]; letterHouses: LetterHouse[] }>(`/congregations/${cid}/buildings${onlyLetters ? '?onlyLetters=1' : ''}`), [cid, onlyLetters]);
  return (
    <Layout title="Prédios e cartas" subtitle={cong.data?.congregation.name} cid={cid} isAdmin={cong.data?.isAdmin} viaGlobal={cong.data?.viaGlobal}>
      <div className="tabs" role="group" aria-label="Filtro">
        <button aria-pressed={!onlyLetters} onClick={() => setOnlyLetters(false)}>Todos os prédios</button>
        <button aria-pressed={onlyLetters} onClick={() => setOnlyLetters(true)}>Só com carta pendente</button>
      </div>
      {d.error && !d.data ? (
        <LoadError error={d.error} onRetry={d.reload} />
      ) : !d.data ? (
        <Loading />
      ) : (
        <>
          {d.data.buildings.length === 0 ? (
            <div className="card center"><p>{onlyLetters ? 'Nenhum prédio com carta pendente.' : 'Nenhum prédio cadastrado.'}</p></div>
          ) : (
            <ul className="list">
              {d.data.buildings.map((b) => (
                <li key={b.id}>
                  <Link className="list-item" to={`/c/${cid}/e/${b.id}`}>
                    <span className="num building">{b.number}</span>
                    <span className="main">
                      <strong>{b.name || `Prédio ${b.number}`}{b.street ? ` · ${b.street}` : ''}</strong>
                      <span className="sub">Território {b.territory_number} · Quadra {b.block_number} · {b.total} apto(s): {b.pending} pendente(s), {b.letter} com carta, {b.contacted} contato(s)</span>
                      {b.letter_units.length > 0 && (
                        <span className="sub" style={{ color: 'var(--accent-700)', fontWeight: 600 }}>
                          Carta: {b.letter_units.map((u) => `${unitLabel(u)} (${fmtDate(u.lastLetterOn).slice(0, 5)})`).join(', ')}
                        </span>
                      )}
                    </span>
                    <Icon name="chev" className="chev" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {onlyLetters && (
            <>
              <div className="section-title"><h2>Casas com carta pendente</h2></div>
              {d.data.letterHouses.length === 0 ? (
                <div className="card center"><p className="muted">Nenhuma.</p></div>
              ) : (
                <ul className="list">
                  {d.data.letterHouses.map((h) => (
                    <li key={h.id}>
                      <Link className="list-item" to={`/c/${cid}/e/${h.id}`}>
                        <span className="num">{h.number}</span>
                        <span className="main">
                          <strong>{h.street ? `${h.street}, ${h.number}` : `Casa ${h.number}`}</strong>
                          <span className="sub">Território {h.territory_number} · Quadra {h.block_number} · carta em {fmtDate(h.last_letter_on)}</span>
                        </span>
                        <Icon name="chev" className="chev" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </Layout>
  );
}

// ---------------- Gerenciar (administrador) ----------------
interface Code { id: string; code_hint: string; label: string | null; created_at: string; expires_at: string; used_at: string | null; used_by_name: string | null; created_by_name: string; state: 'active' | 'used' | 'expired' | 'canceled' }
interface Member { id: string; role: 'publisher' | 'admin'; status: 'active' | 'revoked'; joined_at: string; revoked_at: string | null; user_id: string; name: string; email: string | null; last_record_at: string | null }

const CODE_STATE = { active: 'Disponível', used: 'Usado', expired: 'Expirado', canceled: 'Cancelado' };

export function AdminPage() {
  const { cid = '' } = useParams();
  const cong = useCong(cid);
  const [tab, setTab] = useState<'codes' | 'members' | 'cong' | 'audit'>('codes');
  return (
    <Layout title="Gerenciar" subtitle={cong.data?.congregation.name} cid={cid} isAdmin viaGlobal={cong.data?.viaGlobal}>
      <div className="tabs" role="group">
        {(
          [
            ['codes', 'Códigos'],
            ['members', 'Membros'],
            ['cong', 'Congregação'],
            ['audit', 'Atividade'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'codes' && <Codes cid={cid} />}
      {tab === 'members' && <Members cid={cid} />}
      {tab === 'cong' && cong.data && <CongForm cid={cid} initial={cong.data.congregation} onSaved={cong.reload} />}
      {tab === 'audit' && <AuditList url={`/congregations/${cid}/audit`} />}
    </Layout>
  );
}

function Codes({ cid }: { cid: string }) {
  const d = useLoad(() => api.get<{ codes: Code[] }>(`/congregations/${cid}/codes`), [cid]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ code: string; expiresAt: string } | null>(null);
  const cancel = useAction();
  const toast = useToast();
  return (
    <>
      <Alert kind="info">Cada código serve para <b>uma pessoa</b>, uma única vez, e libera apenas o perfil Publicador. Envie por mensagem individual.</Alert>
      <button className="btn block" onClick={() => setCreating(true)}><Icon name="key" /> Gerar código</button>
      <div className="section-title"><h2>Códigos gerados</h2></div>
      <ErrorAlert error={cancel.error} />
      {d.error && !d.data ? (
        <LoadError error={d.error} onRetry={d.reload} />
      ) : !d.data ? (
        <Loading />
      ) : d.data.codes.length === 0 ? (
        <div className="card center"><p className="muted">Nenhum código gerado ainda.</p></div>
      ) : (
        <ul className="list">
          {d.data.codes.map((c) => (
            <li key={c.id} className="list-item" style={{ cursor: 'default' }}>
              <span className="main">
                <strong>…{c.code_hint}{c.label ? ` · ${c.label}` : ''}</strong>
                <span className="sub">
                  {c.state === 'used' ? `Usado por ${c.used_by_name ?? '—'} em ${fmtDateTime(c.used_at!)}` : `Válido até ${fmtDateTime(c.expires_at)}`}
                </span>
              </span>
              <span className={`chip ${c.state}`}>{CODE_STATE[c.state]}</span>
              {c.state === 'active' && (
                <button
                  className="btn ghost small"
                  disabled={cancel.busy}
                  onClick={async () => {
                    if (!window.confirm('Cancelar este código? Ele deixará de funcionar.')) return;
                    if (await cancel.run(() => api.post(`/congregations/${cid}/codes/${c.id}/cancel`))) {
                      toast('Código cancelado');
                      d.reload();
                    }
                  }}
                >
                  Cancelar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <NewCodeSheet
          cid={cid}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setCreated(c);
            d.reload();
          }}
        />
      )}
      {created && (
        <Sheet title="Código gerado" onClose={() => setCreated(null)}>
          <p>Envie este código à pessoa. Ele <b>não será mostrado novamente</b>.</p>
          <div className="code-box" aria-label="Código de acesso">{created.code}</div>
          <p className="small muted" style={{ marginTop: 8 }}>Válido até {fmtDateTime(created.expiresAt)}. Uso único.</p>
          <div className="grid2">
            <button
              className="btn secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created.code);
                  toast('Código copiado');
                } catch {
                  /* área de transferência indisponível */
                }
              }}
            >
              <Icon name="copy" /> Copiar
            </button>
            {'share' in navigator ? (
              <button
                className="btn"
                onClick={() =>
                  navigator
                    .share({ text: `Seu código de acesso ao MapsControl: ${created.code}\nCrie sua conta em ${window.location.origin}/cadastro` })
                    .catch(() => {})
                }
              >
                Compartilhar
              </button>
            ) : (
              <button className="btn" onClick={() => setCreated(null)}>Pronto</button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}

function NewCodeSheet({ cid, onClose, onCreated }: { cid: string; onClose: () => void; onCreated: (c: { code: string; expiresAt: string }) => void }) {
  const [label, setLabel] = useState('');
  const [days, setDays] = useState('7');
  const { busy, error, run } = useAction();
  return (
    <Sheet title="Gerar código" onClose={onClose}>
      <ErrorAlert error={error} />
      <Field label="Para quem? (opcional)" hint="Só para você lembrar. Ex.: “irmão da quinta-feira”. Evite dados pessoais.">
        <input className="input" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Validade">
        <select className="input" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="1">1 dia</option>
          <option value="3">3 dias</option>
          <option value="7">7 dias</option>
          <option value="15">15 dias</option>
          <option value="30">30 dias</option>
        </select>
      </Field>
      <button
        className="btn block"
        disabled={busy}
        onClick={async () => {
          const r = await run(() => api.post<{ code: string; expiresAt: string }>(`/congregations/${cid}/codes`, { label: label || null, validDays: Number(days) }));
          if (r) onCreated(r);
        }}
      >
        {busy ? 'Gerando…' : 'Gerar'}
      </button>
    </Sheet>
  );
}

function Members({ cid }: { cid: string }) {
  const { me } = useSession();
  const d = useLoad(() => api.get<{ members: Member[] }>(`/congregations/${cid}/members`), [cid]);
  const act = useAction();
  const toast = useToast();
  if (d.error && !d.data) return <LoadError error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const active = d.data.members.filter((m) => m.status === 'active');
  const revoked = d.data.members.filter((m) => m.status === 'revoked');
  const row = (m: Member) => (
    <li key={m.id} className="list-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
      <span className="main">
        <strong>{m.name}{m.user_id === me?.user.id ? ' (você)' : ''}</strong>
        <span className="sub">
          {m.email ?? 'conta excluída'} · desde {fmtDate(m.joined_at)}
          {m.last_record_at ? ` · último registro ${fmtDate(m.last_record_at)}` : ''}
          {m.revoked_at ? ` · revogado em ${fmtDate(m.revoked_at)}` : ''}
        </span>
      </span>
      {m.status === 'revoked' ? <span className="chip revoked">Revogado</span> : m.role === 'admin' ? <span className="chip admin">Administrador</span> : <span className="chip active">Publicador</span>}
      {m.status === 'active' && m.user_id !== me?.user.id && (
        <span className="row" style={{ width: '100%', justifyContent: 'flex-end' }}>
          <button
            className="btn ghost small"
            disabled={act.busy}
            onClick={async () => {
              const role = m.role === 'admin' ? 'publisher' : 'admin';
              if (!window.confirm(role === 'admin' ? `Tornar ${m.name} administrador?` : `Tirar ${m.name} de administrador?`)) return;
              if (await act.run(() => api.post(`/congregations/${cid}/members/${m.id}/role`, { role }))) {
                toast('Perfil alterado');
                d.reload();
              }
            }}
          >
            {m.role === 'admin' ? 'Tornar publicador' : 'Tornar administrador'}
          </button>
          <button
            className="btn danger secondary small"
            disabled={act.busy}
            onClick={async () => {
              if (!window.confirm(`Revogar o acesso de ${m.name}? A pessoa sai imediatamente de todos os aparelhos. O histórico registrado por ela é mantido.`)) return;
              if (await act.run(() => api.post(`/congregations/${cid}/members/${m.id}/revoke`))) {
                toast('Acesso revogado');
                d.reload();
              }
            }}
          >
            Revogar acesso
          </button>
        </span>
      )}
    </li>
  );
  return (
    <>
      <ErrorAlert error={act.error} />
      <h2>Ativos ({active.length})</h2>
      <ul className="list">{active.map(row)}</ul>
      {revoked.length > 0 && (
        <>
          <div className="section-title"><h2>Revogados ({revoked.length})</h2></div>
          <ul className="list">{revoked.map(row)}</ul>
        </>
      )}
    </>
  );
}

function CongForm({ cid, initial, onSaved }: { cid: string; initial: { name: string; city: string | null; state: string | null }; onSaved: () => void }) {
  const [f, setF] = useState({ name: initial.name, city: initial.city ?? '', state: initial.state ?? '' });
  const { busy, error, run } = useAction();
  const toast = useToast();
  return (
    <div className="card">
      <ErrorAlert error={error} />
      <Field label="Nome da congregação"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid2" style={{ gridTemplateColumns: '1fr 90px' }}>
        <Field label="Cidade"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
        <Field label="UF"><input className="input" maxLength={2} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} /></Field>
      </div>
      <button
        className="btn block"
        disabled={busy}
        onClick={async () => {
          if (await run(() => api.patch(`/congregations/${cid}`, { name: f.name, city: f.city || null, state: f.state || null }))) {
            toast('Dados salvos');
            onSaved();
          }
        }}
      >
        {busy ? 'Salvando…' : 'Salvar'}
      </button>
    </div>
  );
}

const AUDIT_LABEL: Record<string, string> = {
  'congregation.create': 'Criou a congregação', 'congregation.update': 'Alterou dados da congregação',
  'territory.create': 'Criou território', 'territory.update': 'Alterou território', 'territory.delete': 'Excluiu território', 'territory.import': 'Importou território',
  'block.create': 'Criou quadra', 'block.update': 'Alterou quadra', 'block.delete': 'Excluiu quadra',
  'address.create': 'Cadastrou endereço', 'address.update': 'Alterou endereço', 'address.delete': 'Excluiu endereço',
  'unit.create_bulk': 'Incluiu apartamentos', 'unit.delete': 'Excluiu apartamento',
  'record.contact': 'Registrou contato', 'record.letter': 'Registrou carta', 'record.absent': 'Registrou ausência', 'record.void': 'Anulou registro',
  'code.create': 'Gerou código', 'code.cancel': 'Cancelou código', 'member.join': 'Entrou com código', 'member.revoke': 'Revogou acesso', 'member.role': 'Alterou perfil de membro',
  'global.view_congregation': 'Abriu a congregação (Adm. Geral)', 'global.list_congregations': 'Listou congregações (Adm. Geral)',
};

export function AuditList({ url }: { url: string }) {
  const d = useLoad(() => api.get<{ entries: { at: string; action: string; actor_name: string | null; actor_global: boolean; congregation_name?: string }[] }>(url), [url]);
  if (d.error && !d.data) return <LoadError error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  return (
    <div className="card">
      <table className="simple">
        <tbody>
          {d.data.entries.map((e, i) => (
            <tr key={i}>
              <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.at)}</td>
              <td>
                {AUDIT_LABEL[e.action] ?? e.action}
                <span className="small muted" style={{ display: 'block' }}>
                  {e.actor_name ?? 'Sistema'}{e.actor_global ? ' · Administrador Geral' : ''}{e.congregation_name ? ` · ${e.congregation_name}` : ''}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.data.entries.length === 0 && <p className="muted center">Sem atividade registrada.</p>}
    </div>
  );
}

// ---------------- Administração geral ----------------
export function GlobalPage() {
  const nav = useNavigate();
  const d = useLoad(() => api.get<{ congregations: { id: string; name: string; city: string | null; state: string | null; members: number; territories: number; created_at: string }[] }>('/global/congregations'), []);
  const [tab, setTab] = useState<'list' | 'audit'>('list');
  const [q, setQ] = useState('');
  return (
    <Layout title="Administração geral" subtitle="Todas as congregações">
      <Alert kind="info">Como Administrador Geral você pode ver e corrigir dados de qualquer congregação. Todas as suas ações ficam registradas.</Alert>
      <div className="tabs" role="group">
        <button aria-pressed={tab === 'list'} onClick={() => setTab('list')}>Congregações</button>
        <button aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>Minhas ações</button>
      </div>
      {tab === 'audit' ? (
        <AuditList url="/global/audit" />
      ) : d.error && !d.data ? (
        <LoadError error={d.error} onRetry={d.reload} />
      ) : !d.data ? (
        <Loading />
      ) : (
        <>
          <Field label="Buscar">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou cidade" />
          </Field>
          <ul className="list">
            {d.data.congregations
              .filter((c) => `${c.name} ${c.city ?? ''}`.toLowerCase().includes(q.toLowerCase()))
              .map((c) => (
                <li key={c.id}>
                  <button className="list-item" onClick={() => nav(`/c/${c.id}`)}>
                    <span className="main">
                      <strong>{c.name}</strong>
                      <span className="sub">{[c.city, c.state].filter(Boolean).join('/') || 'Sem cidade'} · {c.members} membro(s) · {c.territories} território(s) · criada em {fmtDate(c.created_at)}</span>
                    </span>
                    <Icon name="chev" className="chev" />
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </Layout>
  );
}
