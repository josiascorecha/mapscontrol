import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
  /** Somente no transporte 'memory' (testes). */
  outbox?: Mail[];
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function createMailer(cfg: Config): Mailer {
  if (cfg.MAIL_TRANSPORT === 'memory') {
    const outbox: Mail[] = [];
    return { outbox, async send(m) { outbox.push(m); } };
  }
  if (cfg.MAIL_TRANSPORT === 'file') {
    // Apenas desenvolvimento: grava .eml local. Bloqueado em produção por loadConfig.
    return {
      async send(m) {
        await mkdir(cfg.MAIL_FILE_DIR, { recursive: true });
        const file = path.join(cfg.MAIL_FILE_DIR, `${Date.now()}-${m.subject.replace(/\W+/g, '_')}.txt`);
        await writeFile(file, `Para: ${m.to}\nAssunto: ${m.subject}\n\n${m.text}\n`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
  });
  return {
    async send(m) {
      await transport.sendMail({ from: cfg.MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  };
}

function layout(title: string, paragraphs: string[], button?: { label: string; url: string }): string {
  const ps = paragraphs.map((p) => `<p style="margin:0 0 16px">${esc(p)}</p>`).join('');
  const btn = button
    ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#3b2f8f;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${esc(button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#555">Se o botão não funcionar, copie este endereço no navegador:<br>${esc(button.url)}</p>`
    : '';
  return `<!doctype html><html lang="pt-BR"><body style="font-family:system-ui,Arial,sans-serif;font-size:16px;color:#1c1b22;background:#f4f4f7;padding:24px">
  <div style="max-width:520px;margin:auto;background:#fff;border-radius:14px;padding:28px">
  <h1 style="font-size:20px;margin:0 0 16px;color:#1e1b4b">${esc(title)}</h1>${ps}${btn}
  <p style="margin:24px 0 0;font-size:13px;color:#666">MapsControl — mensagem automática. Se você não fez esta solicitação, ignore este e-mail.</p>
  </div></body></html>`;
}

export const templates = {
  verify(name: string, url: string): Omit<Mail, 'to'> {
    return {
      subject: 'Confirme seu e-mail — MapsControl',
      text: `Olá, ${name}.\n\nPara ativar sua conta no MapsControl, abra o link abaixo (válido por 24 horas):\n${url}\n\nSe você não criou esta conta, ignore este e-mail.`,
      html: layout('Confirme seu e-mail', [`Olá, ${name}.`, 'Para ativar sua conta no MapsControl, toque no botão abaixo. O link vale por 24 horas.'], {
        label: 'Confirmar e-mail',
        url,
      }),
    };
  },
  alreadyRegistered(url: string): Omit<Mail, 'to'> {
    return {
      subject: 'Tentativa de cadastro — MapsControl',
      text: `Alguém tentou criar uma conta com este e-mail, mas ele já está cadastrado.\nSe foi você e esqueceu a senha, use: ${url}`,
      html: layout('Este e-mail já tem conta', ['Alguém tentou criar uma conta com este e-mail, mas ele já está cadastrado.', 'Se foi você e esqueceu a senha, use o botão abaixo.'], {
        label: 'Redefinir senha',
        url,
      }),
    };
  },
  reset(name: string, url: string): Omit<Mail, 'to'> {
    return {
      subject: 'Redefinição de senha — MapsControl',
      text: `Olá, ${name}.\n\nPara criar uma nova senha, abra o link abaixo (válido por 1 hora):\n${url}`,
      html: layout('Redefinir senha', [`Olá, ${name}.`, 'Para criar uma nova senha, toque no botão abaixo. O link vale por 1 hora.'], {
        label: 'Criar nova senha',
        url,
      }),
    };
  },
  activate(name: string, url: string): Omit<Mail, 'to'> {
    return {
      subject: 'Ative sua conta — MapsControl',
      text: `Olá, ${name}.\n\nUma conta foi preparada para você no MapsControl. Defina sua senha pelo link abaixo (válido por 72 horas):\n${url}`,
      html: layout('Ative sua conta', [`Olá, ${name}.`, 'Uma conta foi preparada para você no MapsControl. Defina sua senha pelo botão abaixo. O link vale por 72 horas.'], {
        label: 'Definir senha',
        url,
      }),
    };
  },
};
