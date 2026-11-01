const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter, once } = require('node:events');
const WebSocket = require('ws');
const { ZeroTTSManager } = require('../lib/tts-manager');

test('server sends visuals immediately, synthesizes once for overlays, prioritizes gifts and falls back after timeout', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zane-tts-server-'));
  process.env.APP_DATA_DIR = temp; process.env.PORT = '0';
  process.env.ADMIN_TOKEN = 'tts_test_' + 'd'.repeat(40);
  const writes = [];
  const worker = new EventEmitter();
  worker.stdout = new EventEmitter(); worker.stderr = new EventEmitter(); worker.stdin = new EventEmitter();
  worker.stdin.write = line => { writes.push(JSON.parse(line)); return true; };
  worker.kill = signal => { worker.killed = signal; };
  const reply = payload => worker.stdout.emit('data', Buffer.from(JSON.stringify(payload) + '\n'));
  const load = Module._load;
  let manager;
  Module._load = function (id, ...args) {
    if (id === './lib/tts-manager') return { ZeroTTSManager: class extends ZeroTTSManager {
      constructor(options) {
        super({ ...options, enabled: true, timeoutMs: 1000, spawnWorker: () => worker });
        manager = this;
        process.nextTick(() => reply({ type: 'ready', voices: ['maichi'] }));
      }
    } };
    return load.call(this, id, ...args);
  };
  const app = require('../server'); Module._load = load;
  const sockets = [];
  try {
    const { port } = await app.start();
    const origin = `http://127.0.0.1:${port}`;
    const rpc = (method, params) => fetch(origin + '/rpc', { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(res => res.json());
    for (let i = 0; i < 2; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
      sockets.push(ws); await once(ws, 'message');
    }
    const next = (method, predicate = () => true) => sockets.map(ws => new Promise(resolve => {
      const receive = data => {
        const msg = JSON.parse(data.toString());
        if (msg.method === method && predicate(msg)) { ws.off('message', receive); resolve(msg); }
      };
      ws.on('message', receive);
    }));
    const messages = next('temple.event');
    assert.ok((await rpc('temple.burnIncense', { user: 'Minh Tâm', uniqueId: 'minhtam', count: 3 })).result);
    assert.equal(writes.length, 1);
    const notifications = await Promise.all(messages);
    for (const msg of notifications) {
      assert.equal(msg.method, 'temple.event');
      assert.equal(msg.params.event.ttsUrl, null);
      assert.equal(msg.params.event.ttsPending, true);
      assert.ok(!JSON.stringify(msg).includes(process.env.ADMIN_TOKEN));
    }
    assert.equal(notifications[0].params.event.id, notifications[1].params.event.id);
    const audio = next('tts.ready');
    reply({ type: 'result', id: writes[0].id, ok: true, voice: 'maichi', url: '/tts-cache/maichi_test.wav' });
    for (const msg of await Promise.all(audio)) {
      assert.equal(msg.params.eventId, notifications[0].params.event.id);
      assert.equal(msg.params.url, '/tts-cache/maichi_test.wav');
    }

    // Full comments must not prevent admission or immediate visual delivery of a gift.
    for (let i = 0; i < 4; i++) await rpc('temple.sendPrayer', { user: `Người xem ${i}`, wish: 'Cầu bình an' });
    const giftVisual = next('temple.event', msg => msg.params.event.priorityTier === 'dragon');
    await rpc('temple.offerGift', { user: 'Người ủng hộ', coins: 100, giftName: 'Quà lớn' });
    for (const msg of await Promise.all(giftVisual)) {
      assert.equal(msg.params.event.priorityTier, 'dragon');
      assert.equal(msg.params.event.ttsPending, true);
    }
    assert.equal(writes.length, 2); // Synthesis still working on the first comment.
    reply({ type: 'result', id: writes[1].id, ok: true, url: '/tts-cache/comment.wav' });
    assert.ok(writes[2].text.includes('Người ủng hộ'));
    assert.equal(manager.active.tier, 'dragon');
    for (let i = 2; i < 6; i++) reply({ type: 'result', id: writes[i].id, ok: true, url: '/tts-cache/test.wav' });
    await new Promise(resolve => setImmediate(resolve));

    const fallback = next('tts.ready', msg => msg.params.error === 'ZeroTTS: synthesis-timeout');
    await rpc('temple.sendPrayer', { user: 'Minh Tâm', uniqueId: 'minhtam', wish: 'Cầu bình an' });
    for (const msg of await Promise.all(fallback)) assert.equal(msg.params.url, null);
    assert.equal(worker.killed, 'SIGKILL');
    assert.equal(manager.ready, false);
    assert.equal(manager.status, 'synthesis-timeout');
  } finally {
    for (const ws of sockets) ws.terminate();
    await app.stop(); fs.rmSync(temp, { recursive: true, force: true });
  }
});
