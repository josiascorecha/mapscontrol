import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Block, type Counts, type Territory } from '../api';
import { PickerMap, TerritoryMap } from '../components/BlockMap';
import { Icon } from '../components/Icon';
import { InstallCard } from '../components/InstallCard';
import { Layout } from '../components/Layout';
import { Alert, ErrorAlert, Field, Loading, LoadError, Sheet, Stats, useAction, useLoad, useToast } from '../components/ui';
import { plural } from '../util';

export interface CongInfo {
  congregation: { id: string; name: string; city: string | null; state: string | null };
  role: string;
  isAdmin: boolean;
  viaGlobal: boolean;
  totals: Counts;
}

export function useCong(cid: string) {
  return useLoad(() => api.get<CongInfo>(`/congregations/${cid}`), [cid]);
}

export function HomePage() {
  const { cid = '' } = useParams();
  const nav = useNavigate();
  const cong = useCong(cid);
  const terr = useLoad(() => api.get<{ territories: Territory[] }>(`/congregations/${cid}/territories`), [cid]);
  const [adding, setAdding] = useState(false);
  const c = cong.data;

  return (
    <Layout
      title={c?.congregation.name ?? 'Carregando…'}
      subtitle={c ? [c.congregation.city, c.congregation.state].filter(Boolean).join(' / ') || undefined : undefined}
      cid={cid}
      isAdmin={c?.isAdmin}
      viaGlobal={c?.viaGlobal}
    >
      <InstallCard />
      {cong.error && !c ? (
        <LoadError error={cong.error} onRetry={cong.reload} />
      ) : !c ? (
        <Loading rows={2} />
      ) : (
        <div className="card">
          <h2>Resumo</h2>
          <Stats c={c.totals} />
          <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
            {plural(c.totals.total, 'casa ou apartamento cadastrado', 'casas e apartamentos cadastrados')}.
          </p>
        </div>
      )}

      <div className="section-title">
        <h2>Territórios</h2>
        {c?.isAdmin && (
          <button className="btn small" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Novo
          </button>
        )}
      </div>
      {terr.error && !terr.data ? (
        <LoadError error={terr.error} onRetry={terr.reload} />
      ) : !terr.data ? (
        <Loading />
      ) : terr.data.territories.length === 0 ? (
        <div className="card center">
          <p>Nenhum território cadastrado ainda.</p>
          {c?.isAdmin ? <p className="muted small">Toque em “Novo” para cadastrar o primeiro território.</p> : <p className="muted small">O administrador ainda vai cadastrar os territórios.</p>}
        </div>
      ) : (
        <ul className="list">
          {terr.data.territories.map((t) => (
            <li key={t.id}>
              <Link className="list-item" to={`/c/${cid}/t/${t.id}`}>
                <span className="num">{t.number}</span>
                <span className="main">
                  <strong>Território {t.number}{t.name ? ` — ${t.name}` : ''}</strong>
                  <span className="sub">
                    {plural(t.blocks ?? 0, 'quadra', 'quadras')} · {t.pending ?? 0} pendente(s) · {t.letter ?? 0} com carta · {t.contacted ?? 0} contato(s)
                  </span>
                </span>
                <Icon name="chev" className="chev" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <TerritoryForm
          cid={cid}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            nav(`/c/${cid}/t/${id}`);
          }}
        />
      )}
    </Layout>
  );
}

function TerritoryForm({ cid, initial, onClose, onSaved }: { cid: string; initial?: Territory; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ number: initial ? String(initial.number) : '', name: initial?.name ?? '', notes: initial?.notes ?? '' });
  const { busy, error, run } = useAction();
  const toast = useToast();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { number: Number(f.number), name: f.name || null, notes: f.notes || null };
    const r = await run(() =>
      initial ? api.patch(`/congregations/${cid}/territories/${initial.id}`, body).then(() => ({ id: initial.id })) : api.post<{ id: string }>(`/congregations/${cid}/territories`, body),
    );
    if (r) {
      toast(initial ? 'Território atualizado' : 'Território criado');
      onSaved(r.id);
    }
  }
  return (
    <Sheet title={initial ? 'Editar território' : 'Novo território'} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorAlert error={error} />
        <Field label="Número">
          <input className="input" inputMode="numeric" pattern="[0-9]*" required value={f.number} onChange={(e) => setF({ ...f, number: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Nome ou localização (opcional)">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Observações (opcional)">
          <textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <button className="btn block" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </form>
    </Sheet>
  );
}

interface TerritoryData {
  territory: Territory;
  isAdmin: boolean;
  blocks: Block[];
}

export function TerritoryPage() {
  const { cid = '', tid = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const d = useLoad(() => api.get<TerritoryData>(`/congregations/${cid}/territories/${tid}`), [cid, tid]);
  const [editBlock, setEditBlock] = useState<Block | 'new' | null>(null);
  const [editTerr, setEditTerr] = useState(false);
  const del = useAction();
  const t = d.data?.territory;

  return (
    <Layout title={t ? `Território ${t.number}` : 'Território'} subtitle={t?.name ?? undefined} cid={cid} back={`/c/${cid}`} isAdmin={d.data?.isAdmin}>
      {d.error && !d.data ? (
        <LoadError error={d.error} onRetry={d.reload} />
      ) : !d.data ? (
        <Loading />
      ) : (
        <>
          <TerritoryMap blocks={d.data.blocks} onOpen={(b) => nav(`/c/${cid}/q/${b.id}`)} />
          {d.data.blocks.some((b) => b.lat == null) && (
            <p className="small muted" style={{ marginTop: 8 }}>
              Algumas quadras ainda não têm posição no mapa{d.data.isAdmin ? ' — edite a quadra para posicionar.' : '.'}
            </p>
          )}
          <div className="section-title">
            <h2>Quadras</h2>
            {d.data.isAdmin && (
              <button className="btn small" onClick={() => setEditBlock('new')}>
                <Icon name="plus" /> Nova quadra
              </button>
            )}
          </div>
          {d.data.blocks.length === 0 ? (
            <div className="card center"><p>Nenhuma quadra cadastrada.</p></div>
          ) : (
            <ul className="list">
              {d.data.blocks.map((b) => (
                <li key={b.id} className="row nowrap" style={{ gap: 0 }}>
                  <Link className="list-item" to={`/c/${cid}/q/${b.id}`}>
                    <span className="num">{b.number}</span>
                    <span className="main">
                      <strong>Quadra {b.number}{b.name ? ` — ${b.name}` : ''}</strong>
                      <span className="sub">
                        {b.total ?? 0} endereço(s) · {b.pending ?? 0} pendente(s) · {b.letter ?? 0} com carta
                        {b.lat == null ? ' · sem posição' : ''}
                      </span>
                    </span>
                    <Icon name="chev" className="chev" />
                  </Link>
                  {d.data!.isAdmin && (
                    <button className="icon-btn" aria-label={`Editar quadra ${b.number}`} onClick={() => setEditBlock(b)} style={{ marginRight: 6 }}>
                      <Icon name="edit" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {d.data.isAdmin && (
            <div className="card" style={{ marginTop: 22 }}>
              <h3>Administração do território</h3>
              <ErrorAlert error={del.error} />
              <div className="row">
                <button className="btn secondary small" onClick={() => setEditTerr(true)}><Icon name="edit" /> Editar dados</button>
                <button
                  className="btn danger secondary small"
                  disabled={del.busy}
                  onClick={async () => {
                    if (!window.confirm(`Excluir o território ${t!.number} com todas as quadras, endereços e históricos? Esta ação não pode ser desfeita.`)) return;
                    if (await del.run(() => api.del(`/congregations/${cid}/territories/${tid}`))) {
                      toast('Território excluído');
                      nav(`/c/${cid}`, { replace: true });
                    }
                  }}
                >
                  <Icon name="trash" /> Excluir território
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {editBlock && d.data && (
        <BlockForm
          cid={cid}
          tid={tid}
          block={editBlock === 'new' ? null : editBlock}
          others={d.data.blocks.filter((b) => editBlock === 'new' || b.id !== editBlock.id)}
          onClose={() => setEditBlock(null)}
          onSaved={() => {
            setEditBlock(null);
            d.reload();
          }}
        />
      )}
      {editTerr && t && (
        <TerritoryForm
          cid={cid}
          initial={t}
          onClose={() => setEditTerr(false)}
          onSaved={() => {
            setEditTerr(false);
            d.reload();
          }}
        />
      )}
    </Layout>
  );
}

const REASONS: Record<string, string> = {
  invalid_url: 'O endereço não parece um link válido do Google Maps (use um link https).',
  domain_not_allowed: 'Só aceitamos links do Google Maps (maps.app.goo.gl ou google.com/maps).',
  no_coordinates: 'Não foi possível descobrir a posição por esse link. Toque no mapa para posicionar a quadra.',
  too_many_redirects: 'O link redirecionou vezes demais. Posicione a quadra tocando no mapa.',
  network_error: 'O servidor não conseguiu consultar o link agora. Posicione a quadra tocando no mapa.',
};

function BlockForm({ cid, tid, block, others, onClose, onSaved }: { cid: string; tid: string; block: Block | null; others: Block[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const nextNumber = Math.max(0, ...others.map((b) => b.number)) + 1;
  const [f, setF] = useState({ number: String(block?.number ?? nextNumber), name: block?.name ?? '', mapsUrl: block?.maps_url ?? '' });
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(block?.lat != null ? { lat: block.lat, lng: block.lng! } : null);
  const [manual, setManual] = useState({ lat: block?.lat != null ? String(block.lat) : '', lng: block?.lng != null ? String(block.lng) : '' });
  const [resolveMsg, setResolveMsg] = useState<{ kind: 'success' | 'warn'; text: string } | null>(null);
  const save = useAction();
  const resolve = useAction();
  const del = useAction();

  const updatePos = (p: { lat: number; lng: number } | null) => {
    setPos(p);
    setManual(p ? { lat: String(p.lat), lng: String(p.lng) } : { lat: '', lng: '' });
  };

  async function doResolve() {
    setResolveMsg(null);
    const r = await resolve.run(() => api.post<{ resolved: boolean; lat?: number; lng?: number; reason?: string }>(`/congregations/${cid}/maps/resolve`, { url: f.mapsUrl }));
    if (!r) return;
    if (r.resolved) {
      updatePos({ lat: r.lat!, lng: r.lng! });
      setResolveMsg({ kind: 'success', text: 'Posição encontrada. Confira no mapa e arraste o marcador se precisar ajustar.' });
    } else setResolveMsg({ kind: 'warn', text: REASONS[r.reason ?? 'no_coordinates'] });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const lat = manual.lat.trim() ? Number(manual.lat.replace(',', '.')) : null;
    const lng = manual.lng.trim() ? Number(manual.lng.replace(',', '.')) : null;
    if ((lat == null) !== (lng == null) || (lat != null && (Number.isNaN(lat) || Number.isNaN(lng!)))) {
      return save.setError(new ApiError(400, 'VALIDATION', 'Informe latitude e longitude válidas, ou deixe as duas em branco.'));
    }
    const body = { number: Number(f.number), name: f.name || null, mapsUrl: f.mapsUrl || null, lat, lng };
    const ok = await save.run(() => (block ? api.patch(`/congregations/${cid}/blocks/${block.id}`, body) : api.post(`/congregations/${cid}/territories/${tid}/blocks`, body)));
    if (ok) {
      toast(block ? 'Quadra atualizada' : 'Quadra criada');
      onSaved();
    }
  }

  return (
    <Sheet title={block ? `Editar quadra ${block.number}` : 'Nova quadra'} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorAlert error={save.error} />
        <div className="grid2" style={{ gridTemplateColumns: '110px 1fr' }}>
          <Field label="Número">
            <input className="input" inputMode="numeric" required value={f.number} onChange={(e) => setF({ ...f, number: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Nome ou referência">
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
        </div>
        <Field label="Link do Google Maps (opcional)" hint="Cole o link compartilhado pelo Google Maps e toque em “Buscar posição”.">
          <input className="input" inputMode="url" value={f.mapsUrl} onChange={(e) => setF({ ...f, mapsUrl: e.target.value })} placeholder="https://maps.app.goo.gl/…" />
        </Field>
        <button type="button" className="btn secondary block" style={{ marginTop: -4, marginBottom: 14 }} disabled={!f.mapsUrl || resolve.busy} onClick={doResolve}>
          <Icon name="pin" /> {resolve.busy ? 'Buscando…' : 'Buscar posição pelo link'}
        </button>
        <ErrorAlert error={resolve.error} />
        {resolveMsg && <Alert kind={resolveMsg.kind}>{resolveMsg.text}</Alert>}
        <p className="small muted" style={{ marginBottom: 8 }}>Toque no mapa para posicionar o marcador ou arraste-o para ajustar.</p>
        <PickerMap value={pos} number={Number(f.number)} others={others} onChange={updatePos} />
        <div className="grid2" style={{ marginTop: 12 }}>
          <Field label="Latitude">
            <input className="input" inputMode="decimal" value={manual.lat} onChange={(e) => { const m = { ...manual, lat: e.target.value }; setManual(m); syncManual(m, setPos); }} />
          </Field>
          <Field label="Longitude">
            <input className="input" inputMode="decimal" value={manual.lng} onChange={(e) => { const m = { ...manual, lng: e.target.value }; setManual(m); syncManual(m, setPos); }} />
          </Field>
        </div>
        {/* Sempre renderizado (desabilitado sem posição) para não deslocar o botão Salvar. */}
        <button type="button" className="btn ghost small" disabled={!pos} onClick={() => updatePos(null)} style={{ marginBottom: 10 }}>
          Remover posição
        </button>
        <button className="btn block" disabled={save.busy}>{save.busy ? 'Salvando…' : 'Salvar quadra'}</button>
        {block && (
          <>
            <ErrorAlert error={del.error} />
            <button
              type="button"
              className="btn danger secondary block"
              style={{ marginTop: 10 }}
              disabled={del.busy}
              onClick={async () => {
                if (!window.confirm(`Excluir a quadra ${block.number} com todos os endereços e históricos?`)) return;
                if (await del.run(() => api.del(`/congregations/${cid}/blocks/${block.id}`))) {
                  toast('Quadra excluída');
                  onSaved();
                }
              }}
            >
              Excluir quadra
            </button>
          </>
        )}
      </form>
    </Sheet>
  );
}

function syncManual(m: { lat: string; lng: string }, setPos: (p: { lat: number; lng: number } | null) => void) {
  const lat = Number(m.lat.replace(',', '.'));
  const lng = Number(m.lng.replace(',', '.'));
  if (m.lat && m.lng && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) setPos({ lat, lng });
}
