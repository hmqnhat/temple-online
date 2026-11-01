const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ZeroTTSManager } = require('../lib/tts-manager');

function fixture(options = {}) {
  const worker = new EventEmitter();
  worker.stdout = new EventEmitter(); worker.stderr = new EventEmitter(); worker.stdin = new EventEmitter();
  const writes = [];
  worker.stdin.write = line => { writes.push(JSON.parse(line)); return true; };
  worker.kill = signal => { worker.killed = signal; };
  let environment;
  const manager = new ZeroTTSManager({ enabled: true, timeoutMs: 1000, ...options,
    spawnWorker: (_bin, _args, opts) => { environment = opts.env; return worker; } });
  const reply = payload => worker.stdout.emit('data', Buffer.from(JSON.stringify(payload) + '\n'));
  reply({ type: 'ready', voices: ['maichi'] });
  return { manager, worker, writes, reply, environment };
}

test('TTS disabled by default; worker gets no inherited credentials', () => {
  const disabled = new ZeroTTSManager({ enabled: false });
  assert.equal(disabled.status, 'disabled');
  process.env.AWS_SECRET_ACCESS_KEY = 'fake-secret';
  const f = fixture();
  assert.equal(f.environment.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(f.environment.TTS_ALLOW_MODEL_DOWNLOAD, '0');
  assert.equal(f.environment.COLOREDLOGS_AUTO_INSTALL, undefined);
  assert.equal(f.environment.HF_HUB_DISABLE_IMPLICIT_TOKEN, '1');
  assert.equal(f.environment.HF_HUB_DISABLE_TELEMETRY, '1');
  assert.ok(f.environment.ZEROTTS_VOICES_HOME.endsWith('/voices'));
  f.manager.stop(); delete process.env.AWS_SECRET_ACCESS_KEY;
});

test('text and voice limits apply before creating work', async () => {
  const { manager, writes } = fixture();
  for (const text of ['', {}, 'a'.repeat(321)]) assert.equal((await manager.synthesize(text)).ok, false);
  assert.equal((await manager.synthesize('Xin chào', '../../etc/passwd')).ok, false);
  assert.equal(writes.length, 0); manager.stop();
});

test('one active job; bounded queue; concurrent identical text is deduplicated', async () => {
  const { manager, writes, reply } = fixture();
  const first = manager.synthesize('Xin chào');
  assert.equal(manager.synthesize('Xin chào'), first);
  const jobs = [first, manager.synthesize('Câu hai'), manager.synthesize('Câu ba'), manager.synthesize('Câu bốn')];
  assert.equal(writes.length, 1);
  assert.equal((await manager.synthesize('Câu năm')).ok, false);
  for (let i = 0; i < 4; i++) {
    const id = writes[i].id;
    reply({ type: 'result', id, ok: true, voice: 'maichi', url: `/tts-cache/maichi_${id}.wav` });
  }
  assert.ok((await Promise.all(jobs)).every(result => result.ok));
  assert.equal(manager.inflight.size, 0); manager.stop();
});

test('timeout kills Python and resolves all waiting jobs, leaving no background work', async () => {
  const { manager, worker } = fixture({ timeoutMs: 20 });
  const jobs = [manager.synthesize('Xin chào'), manager.synthesize('Câu tiếp theo')];
  assert.ok((await Promise.all(jobs)).every(result => !result.ok));
  assert.equal(worker.killed, 'SIGKILL');
  assert.equal(manager.status, 'synthesis-timeout');
  assert.equal(manager.active, null);
  assert.equal(manager.queue.length, 0);
  worker.emit('exit', null);
  assert.equal(manager.status, 'synthesis-timeout');
});

test('20 requests per minute and no worker URLs outside the audio cache', async () => {
  const { manager, reply, writes } = fixture();
  for (let i = 0; i < 20; i++) {
    const promise = manager.synthesize(`Câu số ${i}`);
    reply({ type: 'result', id: writes[i].id, ok: true, url: 'http://127.0.0.1/private' });
    assert.equal((await promise).ok, false);
  }
  assert.equal((await manager.synthesize('Câu quá giới hạn')).ok, false);
  assert.equal(writes.length, 20); manager.stop();
});

test('startup failure, pipe errors and oversized output stop the worker', async () => {
  for (const kind of ['error', 'pipe', 'output']) {
    const { manager, worker } = fixture();
    const pending = manager.synthesize('Xin chào');
    if (kind === 'error') worker.emit('error', new Error('spawn failed'));
    if (kind === 'pipe') worker.stdin.emit('error', new Error('EPIPE'));
    if (kind === 'output') worker.stdout.emit('data', Buffer.alloc(65537, 65));
    assert.equal((await pending).ok, false);
    assert.equal(worker.killed, 'SIGKILL');
    assert.equal(manager.ready, false);
  }
});
