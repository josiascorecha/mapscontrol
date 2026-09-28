import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue.path.join('.');
    throw badRequest(issue.message && !issue.message.startsWith('Invalid') ? issue.message : `Campo inválido: ${field || 'dados'}`, 'VALIDATION');
  }
  return r.data;
}

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Identificador inválido');

export const email = z
  .string({ message: 'Informe o e-mail.' })
  .trim()
  .toLowerCase()
  .max(254, 'E-mail muito longo.')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'E-mail inválido.');

// Senhas muito comuns que atendem à regra mas são adivinhadas nas primeiras tentativas.
const COMMON_PASSWORDS = new Set([
  'abc123', 'abcd1234', 'a12345', 'a123456', '123abc', '1234abc', 'abc12345', 'qwerty1', 'qwe123',
  'senha1', 'senha12', 'senha123', 'senha1234', 'mudar123', 'teste1', 'teste123', 'admin1', 'admin123',
  'jesus1', 'jeova1', 'jeova123', 'brasil1', 'brasil123', 'mapas1', 'mapscontrol1', 'password1',
]);

// Regra combinada com o titular: mínimo 6 caracteres, com pelo menos uma letra e um número.
// Símbolos são permitidos, mas não exigidos. Proteções complementares: limite de tentativas
// de login por e-mail e por IP, e hash Argon2id.
export const password = z
  .string({ message: 'Informe a senha.' })
  .min(6, 'A senha precisa ter pelo menos 6 caracteres.')
  .max(200, 'Senha muito longa.')
  .refine((v) => /[A-Za-zÀ-ÿ]/.test(v) && /\d/.test(v), { message: 'A senha precisa ter letras e números.' })
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), { message: 'Essa senha é muito comum. Escolha outra.' });

export const personName = z.string({ message: 'Informe o nome.' }).trim().min(2, 'Informe o nome.').max(120, 'Nome muito longo.');

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Texto muito longo (máximo ${max} caracteres).`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const optionalText = optText;

const PHONE = /(?:\+?\d[\s().-]?){8,}/;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const CPF = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

/** Observações operacionais: bloqueia padrões de telefone, e-mail e CPF para não incentivar dados pessoais. */
export const operationalNote = (max: number) =>
  optText(max).refine((v) => !v || !(PHONE.test(v) || EMAIL_LIKE.test(v) || CPF.test(v)), {
    message: 'Não registre telefone, e-mail ou documentos de moradores nas observações.',
  });

export const isoDate = z
  .string({ message: 'Informe a data.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.')
  .refine((s) => {
    const d = new Date(`${s}T12:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
    const max = Date.now() + 36 * 3600_000; // tolerância de fuso
    return d.getTime() <= max && s >= '2000-01-01';
  }, 'Data inválida ou no futuro.');
