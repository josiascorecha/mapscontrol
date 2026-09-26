// Critério 11: registros persistem após reiniciar o serviço (novo processo de app e novo pool).
import { describe, expect, it } from 'vitest';
import { client, daysAgo, newCongregation, startApp } from './helpers.js';

describe('11. persistência após reinício', () => {
  it('dados e sessões sobrevivem ao reinício', async () => {
    const first = await startApp();
    const cong = await newCongregation(first, 'Persistente');
    const h = await cong.admin.c.post(`/api/congregations/${cong.cid}/blocks/${cong.bid}/addresses`, { number: '123' });
    await cong.admin.c.post(`/api/congregations/${cong.cid}/addresses/${h.body.id}/records`, { action: 'letter', occurredOn: daysAgo(2) });
    const cookie = cong.admin.c.cookie;
    // limite de tentativas também persiste
    await first.close();

    const second = await startApp({ reset: false });
    const c = client(second.app, cookie);
    const r = await c.get(`/api/congregations/${cong.cid}/addresses/${h.body.id}`);
    expect(r.status).toBe(200);
    expect(r.body.status).toMatchObject({ status: 'letter', last_letter_on: daysAgo(2) });
    const t = await c.get(`/api/congregations/${cong.cid}/territories`);
    expect(t.body.territories[0]).toMatchObject({ number: 1, letter: 1, total: 1 });
    await second.close();
  });
});
