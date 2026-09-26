import { useMemo, useState } from 'react';
import { Field } from './ui';

export interface UnitDraft {
  tower: string;
  identifier: string;
}

/**
 * Montagem de apartamentos em lote, com revisão antes de salvar.
 * Modo "andares": gera 101..104, 201..204 etc. Modo "lista": números separados por vírgula ou linha.
 */
export function UnitsBuilder({ value, onChange }: { value: UnitDraft[]; onChange: (u: UnitDraft[]) => void }) {
  const [mode, setMode] = useState<'floors' | 'list'>('floors');
  const [tower, setTower] = useState('');
  const [floors, setFloors] = useState({ from: '1', to: '4', per: '4', start: '1' });
  const [list, setList] = useState('');

  const generated = useMemo<UnitDraft[]>(() => {
    const t = tower.trim();
    if (mode === 'list') {
      return list
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 500)
        .map((identifier) => ({ tower: t, identifier: identifier.slice(0, 20) }));
    }
    const from = Number(floors.from), to = Number(floors.to), per = Number(floors.per), start = Number(floors.start);
    if (![from, to, per, start].every(Number.isInteger) || from > to || per < 1 || to - from > 60 || per > 30) return [];
    const out: UnitDraft[] = [];
    for (let f = from; f <= to; f++) for (let a = start; a < start + per; a++) out.push({ tower: t, identifier: `${f}${String(a).padStart(2, '0')}` });
    return out;
  }, [mode, tower, floors, list]);

  const num = (k: keyof typeof floors) => (e: { target: { value: string } }) => setFloors({ ...floors, [k]: e.target.value.replace(/\D/g, '') });
  const key = (u: UnitDraft) => `${u.tower}|${u.identifier}`;

  return (
    <div>
      <div className="segmented" role="group" aria-label="Como cadastrar" style={{ marginBottom: 12 }}>
        <button type="button" aria-pressed={mode === 'floors'} onClick={() => setMode('floors')}>Por andares</button>
        <button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>Digitar lista</button>
      </div>
      <Field label="Bloco ou torre (opcional)" hint="Deixe em branco se o prédio tiver um só bloco.">
        <input className="input" maxLength={30} value={tower} onChange={(e) => setTower(e.target.value)} placeholder="Ex.: A, Torre 2" />
      </Field>
      {mode === 'floors' ? (
        <div className="grid2">
          <Field label="Do andar"><input className="input" inputMode="numeric" value={floors.from} onChange={num('from')} /></Field>
          <Field label="Até o andar"><input className="input" inputMode="numeric" value={floors.to} onChange={num('to')} /></Field>
          <Field label="Aptos por andar"><input className="input" inputMode="numeric" value={floors.per} onChange={num('per')} /></Field>
          <Field label="Final começa em"><input className="input" inputMode="numeric" value={floors.start} onChange={num('start')} /></Field>
        </div>
      ) : (
        <Field label="Números dos apartamentos" hint="Separe por vírgula ou um por linha. Ex.: 101, 102, 201, Cobertura">
          <textarea className="input" value={list} onChange={(e) => setList(e.target.value)} />
        </Field>
      )}
      <button
        type="button"
        className="btn secondary block"
        disabled={!generated.length}
        onClick={() => {
          const seen = new Set(value.map(key));
          onChange([...value, ...generated.filter((u) => !seen.has(key(u)))]);
        }}
      >
        Adicionar {generated.length} à revisão
      </button>
      {value.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <strong className="grow">Revisão: {value.length} apartamento(s)</strong>
            <button type="button" className="btn ghost small" onClick={() => onChange([])}>Limpar</button>
          </div>
          <p className="small muted" style={{ marginBottom: 6 }}>Toque em um número para retirá-lo.</p>
          <div className="preview-chips">
            {value.map((u) => (
              <button type="button" key={key(u)} onClick={() => onChange(value.filter((x) => key(x) !== key(u)))} aria-label={`Remover ${u.tower} ${u.identifier}`}>
                {u.tower ? `${u.tower}·` : ''}
                {u.identifier} ✕
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
