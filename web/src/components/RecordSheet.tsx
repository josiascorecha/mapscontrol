import { useState } from 'react';
import { api, type Status } from '../api';
import { todayLocal } from '../util';
import { Icon } from './Icon';
import { ErrorAlert, Field, Sheet, StatusChip, useAction, useToast } from './ui';

type Action = 'contact' | 'letter' | 'absent';

/**
 * Registro rápido: 1 toque na ação + Salvar. Data padrão = hoje.
 * Só informa sucesso depois da confirmação do servidor; em caso de falha
 * mantém tudo o que foi preenchido.
 */
export function RecordSheet({
  cid,
  addressId,
  unitId,
  title,
  status,
  onClose,
  onSaved,
  onHistory,
  onEdit,
}: {
  cid: string;
  addressId: string;
  unitId?: string;
  title: string;
  status?: Status | null;
  onClose: () => void;
  onSaved: () => void;
  onHistory?: () => void;
  /** Abre a correção do número (casa) ou do apartamento. */
  onEdit?: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const toast = useToast();

  async function save() {
    if (!action) return;
    const ok = await run(() => api.post(`/congregations/${cid}/addresses/${addressId}/records`, { unitId: unitId ?? null, action, occurredOn: date, note: note || null }));
    if (ok) {
      toast(action === 'contact' ? 'Contato registrado' : action === 'letter' ? 'Carta registrada' : 'Ausência registrada');
      onSaved();
    }
  }

  const opt = (a: Action, icon: 'chat' | 'mail' | 'door', label: string, sub: string) => (
    <button type="button" className={`action-btn ${a}`} aria-pressed={action === a} onClick={() => setAction(a)}>
      <Icon name={icon} />
      <span>
        {label}
        <small>{sub}</small>
      </span>
    </button>
  );

  return (
    <Sheet title={title} onClose={onClose}>
      {status && <p style={{ marginTop: -4 }}><StatusChip status={status} /></p>}
      <div className="action-grid" role="group" aria-label="O que aconteceu?">
        {opt('contact', 'chat', 'Conversei com alguém', 'Marca contato realizado com a data')}
        {opt('letter', 'mail', 'Deixei uma carta', 'Continua pendente até haver conversa')}
        {opt('absent', 'door', 'Ninguém atendeu', 'Só entra no histórico')}
      </div>
      <Field label={action === 'letter' ? 'Data da carta' : action === 'absent' ? 'Data da tentativa' : 'Data da conversa'}>
        <input className="input" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Observação (opcional)" hint="Só informações práticas (ex.: “portão com cachorro”). Não anote nomes, telefones ou crenças de moradores.">
        <textarea className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorAlert error={error} />
      <button className="btn block" disabled={!action || busy} onClick={save}>
        {busy ? 'Salvando…' : action ? 'Salvar registro' : 'Escolha uma opção acima'}
      </button>
      {onEdit && (
        <button className="btn ghost block" style={{ marginTop: 8 }} onClick={onEdit}>
          <Icon name="edit" /> Corrigir número
        </button>
      )}
      {onHistory && (
        <button className="btn ghost block" style={{ marginTop: 8 }} onClick={onHistory}>
          <Icon name="history" /> Ver histórico
        </button>
      )}
    </Sheet>
  );
}
