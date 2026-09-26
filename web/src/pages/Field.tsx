import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type AddressRow, type Status, type Unit, type VisitRecord } from '../api';
import { Icon } from '../components/Icon';
import { Layout } from '../components/Layout';
import { RecordSheet } from '../components/RecordSheet';
import { UnitsBuilder, type UnitDraft } from '../components/UnitsBuilder';
import { Alert, ErrorAlert, Field, Loading, LoadError, Sheet, Stats, StatusChip, useAction, useLoad, useToast } from '../components/ui';
import { ACTION_LABEL, fmtDate, fmtDateTime, unitLabel } from '../util';

interface BlockData {
  block: { id: string; number: number; name: string | null; territory_id: string; territory_number: number; territory_name: string | null; googleMapsUrl: string | null };
  isAdmin: boolean;
  addresses: AddressRow[];
}

type Filter = 'all' | 'pending' | 'letter' | 'contacted' | 'building';

function houseLine(a: AddressRow): string {
  if (a.status === 'contacted') return `Contato em ${fmtDate(a.last_contact_on)}`;
  if (a.status === 'letter') return `Carta em ${fmtDate(a.last_letter_on)}`;
  return a.last_absent_on ? `Sem contato · última tentativa ${fmtDate(a.last_absent_on)}` : 'Sem contato';
}

export function BlockPage() {
  const { cid = '', bid = '' } = useParams();
  const nav = useNavigate();
  const d = useLoad(() => api.get<BlockData>(`/congregations/${cid}/blocks/${bid}`), [cid, bid]);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  const [recording, setRecording] = useState<AddressRow | null>(null);
  const b = d.data?.block;

  const list = (d.data?.addresses ?? []).filter((a) => {
    if (filter === 'all') return true;
    if (filter === 'building') return a.kind === 'building';
    if (a.kind === 'building') return (a[filter] ?? 0) > 0;
    return a.status === filter;
  });
  const totals = (d.data?.addresses ?? []).reduce(
    (acc, a) => {
      if (a.kind === 'house' && a.status) {
        acc[a.status]++;
        acc.total++;
      } else {
        acc.pending += a.pending ?? 0;
        acc.letter += a.letter ?? 0;
        acc.contacted += a.contacted ?? 0;
        acc.total += a.total ?? 0;
      }
      return acc;
    },
    { pending: 0, letter: 0, contacted: 0, total: 0 },
  );

  return (
    <Layout
      title={b ? `Quadra ${b.number}${b.name ? ` — ${b.name}` : ''}` : 'Quadra'}
      subtitle={b ? `Território ${b.territory_number}${b.territory_name ? ` — ${b.territory_name}` : ''}` : undefined}
      cid={cid}
      back={b ? `/c/${cid}/t/${b.territory_id}` : true}
      isAdmin={d.data?.isAdmin}
      actions={
        b?.googleMapsUrl ? (
          <a className="icon-btn" href={b.googleMapsUrl} target="_blank" rel="noopener noreferrer" aria-label="Abrir no Google Maps">
            <Icon name="external" />
          </a>
        ) : undefined
      }
    >
      {d.error && !d.data ? (
        <LoadError error={d.error} onRetry={d.reload} />
      ) : !d.data ? (
        <Loading />
      ) : (
        <>
          <div className="card"><Stats c={totals} /></div>
          <button className="btn block" style={{ marginTop: 14 }} onClick={() => setAdding(true)}>
            <Icon name="plus" /> Cadastrar casa ou prédio
          </button>
          <div className="section-title"><h2>Endereços</h2></div>
          <div className="tabs" role="group" aria-label="Filtro">
            {(
              [
                ['all', 'Todos'],
                ['pending', 'Pendentes'],
                ['letter', 'Com carta'],
                ['contacted', 'Contato'],
                ['building', 'Prédios'],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          {list.length === 0 ? (
            <div className="card center">
              <p>{d.data.addresses.length ? 'Nenhum endereço neste filtro.' : 'Nenhum endereço cadastrado nesta quadra.'}</p>
              {!d.data.addresses.length && <p className="small muted">Percorra a quadra e toque em “Cadastrar casa ou prédio”.</p>}
            </div>
          ) : (
            <ul className="list">
              {list.map((a) => (
                <li key={a.id}>
                  {a.kind === 'house' ? (
                    <button className="list-item" onClick={() => setRecording(a)} aria-label={`Casa ${a.number}: registrar visita`}>
                      <span className="num">{a.number}</span>
                      <span className="main">
                        <strong>{a.street ? `${a.street}, ${a.number}` : `Casa ${a.number}`}</strong>
                        <span className="sub">{houseLine(a)}</span>
                      </span>
                      {a.status && <StatusChip status={a.status} />}
                    </button>
                  ) : (
                    <Link className="list-item" to={`/c/${cid}/e/${a.id}`}>
                      <span className="num building">{a.number}</span>
                      <span className="main">
                        <strong>{a.name ? `${a.name}` : `Prédio ${a.number}`}</strong>
                        <span className="sub">
                          {a.total ?? 0} apto(s) · {a.pending ?? 0} pendente(s) · {a.letter ?? 0} com carta · {a.contacted ?? 0} contato(s)
                        </span>
                      </span>
                      <Icon name="chev" className="chev" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {adding && (
        <AddressForm
          cid={cid}
          bid={bid}
          onClose={() => setAdding(false)}
          onSaved={(id, kind, keepOpen) => {
            if (!keepOpen) setAdding(false);
            if (kind === 'building') nav(`/c/${cid}/e/${id}`);
            else d.reload();
          }}
        />
      )}
      {recording && (
        <RecordSheet
          cid={cid}
          addressId={recording.id}
          title={recording.street ? `${recording.street}, ${recording.number}` : `Casa ${recording.number}`}
          status={recording.status}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            d.reload();
          }}
          onHistory={() => nav(`/c/${cid}/e/${recording.id}`)}
        />
      )}
    </Layout>
  );
}

function AddressForm({ cid, bid, onClose, onSaved }: { cid: string; bid: string; onClose: () => void; onSaved: (id: string, kind: 'house' | 'building', keepOpen: boolean) => void }) {
  const [kind, setKind] = useState<'house' | 'building'>('house');
  const [f, setF] = useState({ number: '', street: '', name: '', notes: '' });
  const [units, setUnits] = useState<UnitDraft[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const { busy, error, run } = useAction();
  const toast = useToast();

  async function submit(e: FormEvent, next: boolean) {
    e.preventDefault();
    const r = await run(() =>
      api.post<{ id: string }>(`/congregations/${cid}/blocks/${bid}/addresses`, {
        kind,
        number: f.number,
        street: f.street || null,
        name: kind === 'building' ? f.name || null : null,
        notes: f.notes || null,
        units: kind === 'building' ? units : undefined,
      }),
    );
    if (!r) return; // em caso de erro, tudo o que foi digitado permanece
    toast(kind === 'house' ? `Casa ${f.number} cadastrada` : `Prédio cadastrado com ${units.length} apto(s)`);
    if (next && kind === 'house') {
      setSaved([...saved, f.number]);
      setF({ number: '', street: f.street, name: '', notes: '' }); // mantém a rua para a próxima casa
      onSaved(r.id, kind, true);
    } else onSaved(r.id, kind, false);
  }

  return (
    <Sheet title="Cadastrar endereço" onClose={onClose}>
      <form onSubmit={(e) => submit(e, false)}>
        <div className="segmented" role="group" aria-label="Tipo de endereço" style={{ marginBottom: 14 }}>
          <button type="button" aria-pressed={kind === 'house'} onClick={() => setKind('house')}>Casa</button>
          <button type="button" aria-pressed={kind === 'building'} onClick={() => setKind('building')}>Prédio</button>
        </div>
        {saved.length > 0 && <Alert kind="success">Cadastradas agora: {saved.join(', ')}</Alert>}
        <ErrorAlert error={error} />
        <div className="grid2" style={{ gridTemplateColumns: '120px 1fr' }}>
          <Field label="Número">
            <input className="input" required autoFocus maxLength={20} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
          </Field>
          <Field label="Rua (opcional)">
            <input className="input" maxLength={120} value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} />
          </Field>
        </div>
        {kind === 'building' && (
          <>
            <Field label="Nome do prédio (opcional)">
              <input className="input" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <h3>Apartamentos</h3>
            <UnitsBuilder value={units} onChange={setUnits} />
            <div style={{ height: 14 }} />
          </>
        )}
        <Field label="Observação (opcional)" hint="Só informações práticas. Não anote dados pessoais dos moradores.">
          <input className="input" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        {kind === 'house' ? (
          <div className="grid2">
            <button type="button" className="btn secondary" disabled={busy || !f.number} onClick={(e) => submit(e, true)}>Salvar e próxima</button>
            <button className="btn" disabled={busy || !f.number}>{busy ? 'Salvando…' : 'Salvar'}</button>
          </div>
        ) : (
          <button className="btn block" disabled={busy || !f.number}>
            {busy ? 'Salvando…' : `Salvar prédio${units.length ? ` e ${units.length} apto(s)` : ''}`}
          </button>
        )}
      </form>
    </Sheet>
  );
}

// ---------------- Endereço: histórico da casa ou apartamentos do prédio ----------------
interface AddressData {
  address: { id: string; kind: 'house' | 'building'; number: string; street: string | null; name: string | null; notes: string | null; block_id: string; block_number: number; territory_number: number };
  status: { status: Status; last_contact_on: string | null; last_letter_on: string | null } | null;
  units: Unit[];
  isAdmin: boolean;
  canEdit: boolean;
}

export function AddressPage() {
  const { cid = '', aid = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const d = useLoad(() => api.get<AddressData>(`/congregations/${cid}/addresses/${aid}`), [cid, aid]);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [record, setRecord] = useState<{ unit?: Unit } | null>(null);
  const [addUnits, setAddUnits] = useState(false);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const del = useAction();
  const a = d.data?.address;
  const title = a ? (a.kind === 'building' ? a.name || `Prédio ${a.number}` : a.street ? `${a.street}, ${a.number}` : `Casa ${a.number}`) : 'Endereço';

  const towers = [...new Set((d.data?.units ?? []).map((u) => u.tower))];
  const units = (d.data?.units ?? []).filter((u) => filter === 'all' || u.status === filter);

  return (
    <Layout title={title} subtitle={a ? `Território ${a.territory_number} · Quadra ${a.block_number}` : undefined} cid={cid} back={a ? `/c/${cid}/q/${a.block_id}` : true} isAdmin={d.data?.isAdmin}>
      {d.error && !d.data ? (
        <LoadError error={d.error} onRetry={d.reload} />
      ) : !d.data || !a ? (
        <Loading />
      ) : a.kind === 'house' ? (
        <>
          <div className="card">
            <div className="row">
              <span className="grow"><b>Situação</b></span>
              {d.data.status && <StatusChip status={d.data.status.status} />}
            </div>
            {d.data.status?.last_contact_on && <p style={{ margin: '8px 0 0' }}>Contato realizado em <b>{fmtDate(d.data.status.last_contact_on)}</b></p>}
            {d.data.status?.last_letter_on && <p style={{ margin: '4px 0 0' }}>Carta em <b>{fmtDate(d.data.status.last_letter_on)}</b></p>}
            {a.notes && <p className="small muted" style={{ margin: '8px 0 0' }}>Obs.: {a.notes}</p>}
          </div>
          <button className="btn block" style={{ marginTop: 14 }} onClick={() => setRecord({})}>Registrar visita</button>
          <History cid={cid} aid={aid} key={`h-${d.data.status?.status}-${d.data.status?.last_contact_on}-${d.data.status?.last_letter_on}`} onChanged={d.reload} />
        </>
      ) : unit ? (
        <>
          <button className="btn ghost small" onClick={() => setUnit(null)}><Icon name="back" /> Todos os apartamentos</button>
          <div className="card" style={{ marginTop: 8 }}>
            <div className="row">
              <h2 className="grow" style={{ margin: 0 }}>Apto {unitLabel(unit)}</h2>
              <StatusChip status={unit.status} />
            </div>
            {unit.last_contact_on && <p style={{ margin: '8px 0 0' }}>Contato realizado em <b>{fmtDate(unit.last_contact_on)}</b></p>}
            {unit.last_letter_on && <p style={{ margin: '4px 0 0' }}>Carta em <b>{fmtDate(unit.last_letter_on)}</b></p>}
          </div>
          <button className="btn block" style={{ marginTop: 14 }} onClick={() => setRecord({ unit })}>Registrar visita</button>
          <History cid={cid} aid={aid} unitId={unit.id} key={`${unit.id}-${unit.status}-${unit.last_letter_on}-${unit.last_contact_on}`} onChanged={async () => {
            const fresh = await api.get<AddressData>(`/congregations/${cid}/addresses/${aid}`);
            setUnit(fresh.units.find((u) => u.id === unit.id) ?? null);
            d.reload();
          }} />
          {d.data.isAdmin && (
            <button
              className="btn danger secondary small"
              style={{ marginTop: 20 }}
              onClick={async () => {
                if (!window.confirm(`Excluir o apartamento ${unitLabel(unit)} e seu histórico?`)) return;
                if (await del.run(() => api.del(`/congregations/${cid}/units/${unit.id}`))) {
                  toast('Apartamento excluído');
                  setUnit(null);
                  d.reload();
                }
              }}
            >
              <Icon name="trash" /> Excluir apartamento
            </button>
          )}
        </>
      ) : (
        <>
          <div className="card">
            <Stats c={{ pending: d.data.units.filter((u) => u.status === 'pending').length, letter: d.data.units.filter((u) => u.status === 'letter').length, contacted: d.data.units.filter((u) => u.status === 'contacted').length, total: d.data.units.length }} />
            <p className="small muted" style={{ margin: '10px 0 0' }}>Número {a.number}{a.street ? ` · ${a.street}` : ''}{a.notes ? ` · Obs.: ${a.notes}` : ''}</p>
          </div>
          <div className="section-title">
            <h2>Apartamentos</h2>
            <button className="btn small secondary" onClick={() => setAddUnits(true)}><Icon name="plus" /> Incluir</button>
          </div>
          <div className="tabs" role="group" aria-label="Filtro">
            {(
              [
                ['all', 'Todos'],
                ['pending', 'Pendentes'],
                ['letter', 'Com carta'],
                ['contacted', 'Contato'],
              ] as ['all' | Status, string][]
            ).map(([k, l]) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          {d.data.units.length === 0 ? (
            <div className="card center"><p>Nenhum apartamento cadastrado.</p></div>
          ) : (
            towers.map((t) => {
              const us = units.filter((u) => u.tower === t);
              if (!us.length) return null;
              return (
                <div key={t} style={{ marginBottom: 14 }}>
                  {towers.length > 1 || t ? <h3>{t ? `Bloco/Torre ${t}` : 'Sem bloco'}</h3> : null}
                  <div className="unit-grid">
                    {us.map((u) => (
                      <button key={u.id} className={`unit-btn ${u.status}`} onClick={() => setRecord({ unit: u })} onContextMenu={(e) => { e.preventDefault(); setUnit(u); }}>
                        <b>{u.identifier}</b>
                        <small>
                          {u.status === 'contacted' ? `Contato ${fmtDate(u.last_contact_on).slice(0, 5)}` : u.status === 'letter' ? `Carta ${fmtDate(u.last_letter_on).slice(0, 5)}` : 'Pendente'}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
          <p className="small muted">Toque em um apartamento para registrar. No registro há o botão “Ver histórico”.</p>
          {d.data.isAdmin && (
            <>
              <ErrorAlert error={del.error} />
              <button
                className="btn danger secondary small"
                style={{ marginTop: 12 }}
                onClick={async () => {
                  if (!window.confirm('Excluir este prédio com todos os apartamentos e históricos?')) return;
                  if (await del.run(() => api.del(`/congregations/${cid}/addresses/${aid}`))) {
                    toast('Prédio excluído');
                    nav(`/c/${cid}/q/${a.block_id}`, { replace: true });
                  }
                }}
              >
                <Icon name="trash" /> Excluir prédio
              </button>
            </>
          )}
        </>
      )}
      {a?.kind === 'house' && d.data?.isAdmin && (
        <button
          className="btn danger secondary small"
          style={{ marginTop: 20 }}
          onClick={async () => {
            if (!window.confirm('Excluir esta casa e todo o histórico?')) return;
            if (await del.run(() => api.del(`/congregations/${cid}/addresses/${aid}`))) {
              toast('Casa excluída');
              nav(`/c/${cid}/q/${a.block_id}`, { replace: true });
            }
          }}
        >
          <Icon name="trash" /> Excluir casa
        </button>
      )}
      {record && a && (
        <RecordSheet
          cid={cid}
          addressId={aid}
          unitId={record.unit?.id}
          title={record.unit ? `Apto ${unitLabel(record.unit)}` : title}
          status={record.unit ? record.unit.status : d.data?.status?.status}
          onClose={() => setRecord(null)}
          onSaved={async () => {
            setRecord(null);
            if (unit) {
              const fresh = await api.get<AddressData>(`/congregations/${cid}/addresses/${aid}`).catch(() => null);
              if (fresh) setUnit(fresh.units.find((u) => u.id === unit.id) ?? null);
            }
            d.reload();
          }}
          onHistory={
            record.unit
              ? () => {
                  setUnit(record.unit!);
                  setRecord(null);
                }
              : undefined
          }
        />
      )}
      {addUnits && (
        <AddUnitsSheet
          cid={cid}
          aid={aid}
          onClose={() => setAddUnits(false)}
          onSaved={() => {
            setAddUnits(false);
            d.reload();
          }}
        />
      )}
    </Layout>
  );
}

function AddUnitsSheet({ cid, aid, onClose, onSaved }: { cid: string; aid: string; onClose: () => void; onSaved: () => void }) {
  const [units, setUnits] = useState<UnitDraft[]>([]);
  const { busy, error, run } = useAction();
  const toast = useToast();
  return (
    <Sheet title="Incluir apartamentos" onClose={onClose}>
      <UnitsBuilder value={units} onChange={setUnits} />
      <div style={{ height: 14 }} />
      <ErrorAlert error={error} />
      <button
        className="btn block"
        disabled={!units.length || busy}
        onClick={async () => {
          const r = await run(() => api.post<{ created: number; skipped: string[] }>(`/congregations/${cid}/addresses/${aid}/units`, { units }));
          if (r) {
            toast(`${r.created} apartamento(s) incluído(s)${r.skipped.length ? `; ${r.skipped.length} já existia(m)` : ''}`);
            onSaved();
          }
        }}
      >
        {busy ? 'Salvando…' : `Salvar ${units.length} apartamento(s)`}
      </button>
    </Sheet>
  );
}

function History({ cid, aid, unitId, onChanged }: { cid: string; aid: string; unitId?: string; onChanged: () => void }) {
  const h = useLoad(() => api.get<{ records: VisitRecord[] }>(`/congregations/${cid}/addresses/${aid}/records${unitId ? `?unitId=${unitId}` : ''}`), [cid, aid, unitId]);
  const [voiding, setVoiding] = useState<VisitRecord | null>(null);
  return (
    <>
      <div className="section-title"><h2>Histórico</h2></div>
      {h.error && !h.data ? (
        <LoadError error={h.error} onRetry={h.reload} />
      ) : !h.data ? (
        <Loading rows={2} />
      ) : h.data.records.length === 0 ? (
        <div className="card center"><p className="muted">Nenhum registro ainda.</p></div>
      ) : (
        <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ul className="history">
            {h.data.records.map((r) => (
              <li key={r.id} className={r.voided_at ? 'voided' : ''}>
                <span className="when">{fmtDate(r.occurred_on)}</span>
                <span className="grow">
                  <span className="what"><b>{ACTION_LABEL[r.action]}</b></span>
                  {r.note && <span className="small" style={{ display: 'block' }}>{r.note}</span>}
                  <span className="small muted" style={{ display: 'block' }}>
                    por {r.author_name ?? '—'} · lançado {fmtDateTime(r.created_at)}
                    {r.voided_at && ` · anulado: ${r.void_reason}`}
                  </span>
                </span>
                {r.canVoid && (
                  <button className="btn ghost small" onClick={() => setVoiding(r)} aria-label="Anular registro">Anular</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {voiding && (
        <VoidSheet
          cid={cid}
          record={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            h.reload();
            onChanged();
          }}
        />
      )}
    </>
  );
}

function VoidSheet({ cid, record, onClose, onDone }: { cid: string; record: VisitRecord; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run, setError } = useAction();
  const toast = useToast();
  return (
    <Sheet title="Anular registro" onClose={onClose}>
      <Alert kind="info">
        O registro de {fmtDate(record.occurred_on)} ({ACTION_LABEL[record.action]}) continua visível no histórico, marcado como anulado, e deixa de contar para a situação.
      </Alert>
      <Field label="Motivo">
        <input className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: lancei na casa errada" />
      </Field>
      <ErrorAlert error={error} />
      <button
        className="btn danger block"
        disabled={busy}
        onClick={async () => {
          if (reason.trim().length < 3) return setError(new ApiError(400, 'VALIDATION', 'Informe o motivo.'));
          if (await run(() => api.post(`/congregations/${cid}/records/${record.id}/void`, { reason }))) {
            toast('Registro anulado');
            onDone();
          }
        }}
      >
        {busy ? 'Anulando…' : 'Anular registro'}
      </button>
    </Sheet>
  );
}
