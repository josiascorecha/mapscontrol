// Resolução segura de links do Google Maps (sem rede: o fetcher é simulado).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractCoords, isAllowedHost, isPrivateAddress, resolveMapsLink, type Fetcher } from '../src/lib/maps.js';
import { newCongregation, startApp, type Ctx } from './helpers.js';

const redirects = (map: Record<string, string>): Fetcher => async (url) =>
  map[url] ? { status: 302, location: map[url] } : { status: 200, location: null };

describe('extração de coordenadas', () => {
  it.each([
    ['https://www.google.com.br/maps/search/-25.431201,+-49.271104?entry=tts', -25.431201, -49.271104],
    ['https://www.google.com/maps/place/X/@-25.44,-49.26,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-25.4401!4d-49.2612', -25.4401, -49.2612],
    ['https://www.google.com/maps/@-23.5505,-46.6333,15z', -23.5505, -46.6333],
    ['https://maps.google.com/?q=-22.9,-43.2', -22.9, -43.2],
    ['https://www.google.com/maps/search/?api=1&query=-27.5,-48.5', -27.5, -48.5],
  ])('%s', (url, lat, lng) => {
    expect(extractCoords(url)).toEqual({ lat, lng });
  });
  it('sem coordenadas retorna null', () => {
    expect(extractCoords('https://www.google.com/maps/place/Pra%C3%A7a+Central')).toBeNull();
    expect(extractCoords('https://www.google.com/maps/@0,0,3z')).toBeNull();
  });
});

describe('proteções', () => {
  it('domínios permitidos', () => {
    for (const h of ['maps.app.goo.gl', 'goo.gl', 'www.google.com', 'google.com.br', 'maps.google.com']) expect(isAllowedHost(h)).toBe(true);
    for (const h of ['evil.com', 'google.com.evil.com', 'maps.app.goo.gl.evil.com', 'googlemaps.com', 'localhost', '127.0.0.1'])
      expect(isAllowedHost(h)).toBe(false);
  });
  it('IPs internos são bloqueados', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.17.0.1', '192.168.0.10', '169.254.169.254', '100.64.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0'])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['142.250.79.46', '8.8.8.8', '2800:3f0:4001:80d::200e']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it('recusa http, credenciais, portas e domínios estranhos', async () => {
    const never: Fetcher = async () => { throw new Error('não deveria acessar a rede'); };
    expect(await resolveMapsLink('http://maps.app.goo.gl/abc', never)).toMatchObject({ resolved: false, reason: 'invalid_url' });
    expect(await resolveMapsLink('https://user:pw@maps.app.goo.gl/abc', never)).toMatchObject({ resolved: false });
    expect(await resolveMapsLink('https://maps.app.goo.gl:8443/abc', never)).toMatchObject({ resolved: false });
    expect(await resolveMapsLink('https://169.254.169.254/latest', never)).toMatchObject({ resolved: false, reason: 'domain_not_allowed' });
    expect(await resolveMapsLink('https://goo.gl/xyz', never)).toMatchObject({ resolved: false, reason: 'domain_not_allowed' });
    expect(await resolveMapsLink('not a url', never)).toMatchObject({ resolved: false, reason: 'invalid_url' });
  });
  it('segue redirecionamento de link curto até as coordenadas', async () => {
    const f = redirects({ 'https://maps.app.goo.gl/AbC123': 'https://www.google.com.br/maps/search/-25.433002,+-49.268305?entry=tts' });
    expect(await resolveMapsLink('https://maps.app.goo.gl/AbC123', f)).toMatchObject({ resolved: true, lat: -25.433002, lng: -49.268305 });
  });
  it('não segue redirecionamento para domínio fora da lista', async () => {
    const f = redirects({ 'https://maps.app.goo.gl/x': 'https://evil.example/@-1,-1' });
    expect(await resolveMapsLink('https://maps.app.goo.gl/x', f)).toMatchObject({ resolved: false, reason: 'domain_not_allowed' });
    const g = redirects({ 'https://maps.app.goo.gl/y': 'http://127.0.0.1/' });
    expect(await resolveMapsLink('https://maps.app.goo.gl/y', g)).toMatchObject({ resolved: false, reason: 'domain_not_allowed' });
  });
  it('limita a quantidade de redirecionamentos', async () => {
    const loop: Fetcher = async (url) => ({ status: 302, location: url.endsWith('a') ? 'https://maps.app.goo.gl/b' : 'https://maps.app.goo.gl/a' });
    let calls = 0;
    const counted: Fetcher = async (u) => { calls++; return loop(u); };
    expect(await resolveMapsLink('https://maps.app.goo.gl/a', counted)).toMatchObject({ resolved: false, reason: 'too_many_redirects' });
    expect(calls).toBeLessThanOrEqual(4);
  });
  it('sem coordenadas pede posicionamento manual (não inventa)', async () => {
    const f = redirects({ 'https://maps.app.goo.gl/p': 'https://www.google.com/maps/place/Algum+Lugar' });
    expect(await resolveMapsLink('https://maps.app.goo.gl/p', f)).toEqual({ resolved: false, reason: 'no_coordinates' });
    const err: Fetcher = async () => { throw new Error('timeout'); };
    expect(await resolveMapsLink('https://maps.app.goo.gl/q', err)).toEqual({ resolved: false, reason: 'network_error' });
  });
});

describe('rota de resolução', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await startApp({ fetcher: redirects({ 'https://maps.app.goo.gl/Z': 'https://www.google.com/maps/search/-25.4355,+-49.2651' }) });
  });
  afterAll(() => ctx.close());
  it('administrador resolve e salva a quadra com coordenadas', async () => {
    const cong = await newCongregation(ctx);
    const r = await cong.admin.c.post(`/api/congregations/${cong.cid}/maps/resolve`, { url: 'https://maps.app.goo.gl/Z' });
    expect(r.body).toMatchObject({ resolved: true, lat: -25.4355, lng: -49.2651 });
    const b = await cong.admin.c.post(`/api/congregations/${cong.cid}/territories/${cong.tid}/blocks`, {
      number: 2, mapsUrl: 'https://maps.app.goo.gl/Z', lat: r.body.lat, lng: r.body.lng,
    });
    expect(b.status).toBe(201);
    const t = await cong.admin.c.get(`/api/congregations/${cong.cid}/territories/${cong.tid}`);
    const q2 = t.body.blocks.find((x: any) => x.number === 2);
    expect(q2).toMatchObject({ lat: -25.4355, lng: -49.2651 });
    expect(q2.googleMapsUrl).toContain('query=-25.4355,-49.2651');
    // latitude sem longitude é rejeitada
    expect((await cong.admin.c.post(`/api/congregations/${cong.cid}/territories/${cong.tid}/blocks`, { number: 3, lat: -27 })).status).toBe(400);
  });
});
