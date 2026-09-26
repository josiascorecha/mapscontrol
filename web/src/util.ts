import type { Status } from './api';

/** Data de hoje no fuso do aparelho, no formato AAAA-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export const STATUS_LABEL: Record<Status, string> = {
  pending: 'Pendente',
  letter: 'Com carta',
  contacted: 'Contato realizado',
};

export const ACTION_LABEL = { contact: 'Contato realizado', letter: 'Carta deixada', absent: 'Ninguém atendeu' } as const;

export function unitLabel(u: { tower: string; identifier: string }): string {
  return u.tower ? `${u.tower} · ${u.identifier}` : u.identifier;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
