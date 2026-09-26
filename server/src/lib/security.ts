import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/** Token opaco para cookies e links de e-mail (256 bits). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function hmac(secret: string, value: string): Buffer {
  return createHmac('sha256', secret).update(value).digest();
}

// Alfabeto sem caracteres ambíguos (0/O, 1/I/L, U).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 12; // ~58 bits de entropia

/** Gera código de acesso legível, ex.: "K7QM-ZP3D-9XTA". Usa CSPRNG (crypto.randomInt). */
export function newAccessCode(): string {
  let raw = '';
  for (let i = 0; i < CODE_LENGTH; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Normaliza o que o usuário digitou: maiúsculas, sem espaços/hífens, O→0 não se aplica (alfabeto sem 0/O). */
export function normalizeAccessCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function hashAccessCode(pepper: string, normalized: string): Buffer {
  return hmac(pepper, `access-code:${normalized}`);
}

// Parâmetros Argon2id (OWASP 2023+: m=19 MiB, t=2, p=1).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON);
}

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  if (!hash) {
    // Gasta tempo equivalente para não revelar se a conta existe.
    await argonHash(password, ARGON);
    return false;
  }
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
