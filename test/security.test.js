const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter, once } = require('node:events');
const WebSocket = require('ws');
const { resolveTikTokUsername, safeAvatar, createSecurity } = require('../lib/security');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zane-security-'));
process.env.APP_DATA_DIR = temp;
process.env.PORT = '0';
process.env.ENABLE_TTS = '0';
const token = 'test_only_' + 'a'.repeat(40);
process.env.ADMIN_TOKEN = token;
let connectorCount = 0;
let connector;
class FakeTikTok extends EventEmitter {
  constructor() { super(); connectorCount++; connector = this; }
  async connect() { return { roomId: 'TEST_ROOM' }; }
  async disconnect() { if (this.failDisconnect) throw new Error('Fake disconnect error'); }
}
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === 'tiktok-live-connector') return { TikTokLiveConnection: FakeTikTok,
    WebcastEvent: new Proxy({}, { get: (_, k) => k }), ControlEvent: new Proxy({}, { get: (_, k) => k }) };
  return load.call(this, id, ...args);
};
const app = require('../server');
Module._load = load;
let port, origin;
const auth = () => ({ Authorization: `Bearer ${token}` });
function request(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}
const rpc = (method, params = {}, headers = auth()) => request('/rpc', {
  method: 'POST', headers, body: { jsonrpc: '2.0', id: 1, method, params }
});
function connectWs(headers = { Origin: origin }, suffix = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${suffix}`, { headers });
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => { res.resume(); ws.removeListener('error', reject); resolve({ status: res.statusCode }); });
    ws.once('message', data => resolve({ ws, message: JSON.parse(data.toString()) }));
  });
}
before(async () => { ({ port } = await app.start()); origin = `http://127.0.0.1:${port}`; });
after(async () => { await app.stop(); fs.rmSync(temp, { recursive: true, force: true }); });

test('loopback only; startup does not connect TikTok or spawn TTS', async () => {
  assert.equal(app.server.address().address, '127.0.0.1');
  assert.equal(connectorCount, 0);
  const res = await request('/api/state');
  assert.equal(res.json.tts.status, 'disabled');
  assert.equal(res.json.tiktok.username, '');
  assert.equal(res.json.settings.autoSim, false);
  assert.ok(!res.text.includes(token));
});

test('Host/Origin/Fetch Metadata guards apply to HTTP and websocket upgrades', async () => {
  for (const headers of [{ Host: 'evil.example' }, { Origin: 'https://evil.example' },
    { Origin: `http://localhost:${port}` }, { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' }]) {
    assert.equal((await rpc('temple.resetMerit', {}, { ...auth(), ...headers })).status, 403);
    assert.equal((await connectWs({ Origin: origin, ...headers })).status, 403);
  }
  assert.equal((await connectWs({})).status, 403);
  assert.equal((await connectWs({ Origin: origin }, '?role=admin')).status, 403);
});

test('unauthenticated HTTP cannot reset, connect, speak or synthesize', async () => {
  for (const method of ['temple.resetMerit', 'live.connect', 'temple.speak', 'temple.updateSettings']) {
    assert.equal((await rpc(method, {}, {})).status, 401);
  }
  assert.equal((await request('/api/tts', { method: 'POST', body: { text: 'Xin chào' } })).status, 401);
  assert.equal((await request('/api/tts?text=Xin%20chao')).status, 404);
  assert.equal((await rpc('temple.resetMerit', {}, { Authorization: 'Bearer wrong' })).status, 401);
});

test('browser session requires secret, same origin, HttpOnly cookie and supports logout', async () => {
  assert.equal((await request('/api/session', { method: 'POST', body: { token } })).status, 403);
  assert.equal((await request('/api/session', { method: 'POST', headers: { Origin: origin }, body: { token: 'wrong' } })).status, 401);
  const login = await request('/api/session', { method: 'POST', headers: { Origin: origin }, body: { token } });
  assert.equal(login.status, 200);
  const setCookie = login.headers['set-cookie'][0];
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800/);
  const Cookie = setCookie.split(';')[0];
  assert.equal((await rpc('temple.updateSettings', { musicVolume: 0.4 }, { Cookie })).status, 401);
  const result = await rpc('temple.updateSettings', { musicVolume: 0.4 }, { Cookie, Origin: origin });
  assert.equal(result.json.result.settings.musicVolume, 0.4);
  assert.equal((await request('/api/session', { headers: { Cookie } })).json.authenticated, true);
  assert.equal((await request('/api/session', { method: 'DELETE', headers: { Cookie, Origin: origin } })).status, 200);
  assert.equal((await rpc('temple.resetMerit', {}, { Cookie, Origin: origin })).status, 401);
});

test('websocket is receive-only even when carrying admin bearer credentials', async () => {
  const before = (await request('/api/state')).json.totalMerit;
  const { ws, message } = await connectWs({ Origin: origin, ...auth() });
  assert.equal(message.method, 'temple.state');
  const closing = once(ws, 'close');
  ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'temple.resetMerit', params: {} }));
  assert.equal((await closing)[0], 1008);
  assert.equal((await request('/api/state')).json.totalMerit, before);
});

test('username validation blocks SSRF without sending any canary request', async () => {
  let hits = 0;
  const canary = http.createServer((_req, res) => { hits++; res.end('canary'); });
  await new Promise(resolve => canary.listen(0, '127.0.0.1', resolve));
  try {
    for (const username of [`http://127.0.0.1:${canary.address().port}/canary`, 'https://vt.tiktok.com/example',
      'https://www.tiktok.com/@name', 'www.tiktok.com/@name', '@name/path', 'name?x=1', '', {}, 'a'.repeat(25)]) {
      const response = await rpc('live.connect', { username });
      assert.ok(response.json.error, JSON.stringify(username));
    }
    assert.equal(hits, 0);
    assert.equal(connectorCount, 0);
    assert.equal(resolveTikTokUsername('@hello.world_1'), 'hello.world_1');
  } finally { await new Promise(resolve => canary.close(resolve)); }
});

test('prototype keys and malformed RPC params are rejected before changing state', async () => {
  const merit = (await request('/api/state')).json.totalMerit;
  for (const uniqueId of ['__proto__', 'constructor', 'prototype', 'CONSTRUCTOR']) {
    assert.ok((await rpc('temple.burnIncense', { user: 'Audit User', uniqueId })).json.error);
  }
  for (const params of [null, [], 'text', { coins: {} }, { coins: 1e100 }, { user: 12 }, { count: '2' }, { wish: 'a'.repeat(501) },
    JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.ok((await rpc('temple.offerGift', params)).json.error);
  }
  assert.equal(Object.prototype.name, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal((await request('/api/state')).json.totalMerit, merit);
});

test('legitimate HTTP action broadcasts once to OBS and sanitizes viewer image URLs', async () => {
  const { ws } = await connectWs();
  const event = once(ws, 'message');
  const res = await rpc('temple.burnIncense', { user: 'Minh Tâm', uniqueId: 'minhtam', count: 3,
    avatar: 'http://127.0.0.1/private', wish: 'Cầu bình an' });
  assert.ok(res.json.result.event);
  const notification = JSON.parse((await event)[0].toString());
  assert.equal(notification.method, 'temple.event');
  assert.equal(notification.params.event.avatar, '');
  assert.equal(notification.params.event.ttsUrl, null);
  assert.equal(notification.params.event.user, 'Minh Tâm');
  ws.terminate();
  assert.equal(safeAvatar('https://p16.tiktokcdn.com/test.jpg'), 'https://p16.tiktokcdn.com/test.jpg');
  assert.equal(safeAvatar('https://p16.tiktokcdn.com.evil.example/test.jpg'), '');
  assert.equal(safeAvatar('data:image/svg+xml,<svg onload=alert(1)>'), '');
});

test('TikTok adapter remains manual; live events cannot pollute prototype', async () => {
  const result = await rpc('live.connect', { username: '@test_channel' });
  assert.equal(result.json.result.connected, true);
  assert.equal(connectorCount, 1);
  connector.emit('MEMBER', { uniqueId: '__proto__', nickname: 'Audit User' });
  assert.equal(Object.prototype.name, undefined);
  assert.equal(Object.prototype.merit, undefined);
  const state = (await request('/api/state')).json;
  assert.ok(state.leaderboard.every(viewer => !['__proto__', 'constructor', 'prototype'].includes(viewer.uniqueId)));
  const { ws } = await connectWs();
  for (const [coins, tier] of [[1, 'lotus'], [5, 'lamp'], [20, 'fruit'], [100, 'dragon']]) {
    const notification = once(ws, 'message');
    connector.emit('GIFT', { user: { uniqueId: `gift_${coins}`, nickname: 'Người ủng hộ' },
      giftId: `gift_${coins}`, groupId: `group_${coins}`, repeatCount: 1,
      giftDetails: { diamondCount: coins, name: `Quà ${coins}` } });
    const message = JSON.parse((await notification)[0].toString());
    assert.equal(message.method, 'temple.event');
    assert.equal(message.params.event.coins, coins);
    assert.equal(message.params.event.priorityTier, tier);
  }
  ws.terminate();
  connector.failDisconnect = true;
  assert.equal((await rpc('live.disconnect')).json.result.connected, false);
});

test('body limits, headers, static-file boundaries and external admin script', async () => {
  assert.equal((await request('/rpc', { method: 'POST', body: '{', headers: auth() })).status, 400);
  assert.equal((await request('/rpc', { method: 'POST', body: 'a'.repeat(9000), headers: auth() })).status, 413);
  assert.equal((await request('/rpc', { method: 'POST', body: '{}', headers: { ...auth(), 'Content-Type': 'text/plain' } })).status, 415);
  for (const url of ['/.git/config', '/server.js', '/package.json', '/.env', '/tts-cache/../model-cache/config.json']) {
    assert.equal((await request(url)).status, 404, url);
  }
  const admin = await request('/admin');
  assert.equal(admin.status, 200);
  assert.match(admin.text, /src="\/js\/admin.js"/);
  assert.doesNotMatch(admin.text, /onclick=|<script>/);
  assert.ok(!admin.text.includes(token));
  assert.match(admin.headers['content-security-policy'], /script-src 'self';/);
  assert.equal(admin.headers['access-control-allow-origin'], undefined);
  assert.equal(admin.headers['x-content-type-options'], 'nosniff');
});

test('login and control rates are bounded', async () => {
  const security = createSecurity({ getPort: () => port, token });
  assert.equal(security.allowRate('example', 2), true);
  assert.equal(security.allowRate('example', 2), true);
  assert.equal(security.allowRate('example', 2), false);
  for (let i = 0; i < 5; i++) await request('/api/session', { method: 'POST', headers: { Origin: origin }, body: { token: 'wrong' } });
  assert.equal((await request('/api/session', { method: 'POST', headers: { Origin: origin }, body: { token } })).status, 429);
  let response;
  for (let i = 0; i < 121; i++) response = await rpc('temple.getState');
  assert.equal(response.status, 429);
});
