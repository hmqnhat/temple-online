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

test('reserved gift lanes survive full comments and run in descending tier, FIFO within each tier', async () => {
  const { manager, writes, reply } = fixture();
  const jobs = Array.from({ length: 4 }, (_, i) => manager.synthesize(`Bình luận ${i}`));
  assert.equal((await manager.synthesize('Bình luận tràn')).ok, false);
  const tiers = ['lotus', 'lamp', 'fruit', 'dragon'];
  for (const tier of tiers) {
    jobs.push(manager.synthesize(`${tier} một`, 'maichi', tier));
    jobs.push(manager.synthesize(`${tier} hai`, 'maichi', tier));
  }
  assert.equal(writes.length, 1); // The active CPU job completes without restarting the model.
  assert.deepEqual(manager.getStatus().queuedByTier, { community: 3, lotus: 2, lamp: 2, fruit: 2, dragon: 2 });
  for (let i = 0; i < 12; i++) reply({ type: 'result', id: writes[i].id, ok: true, url: `/tts-cache/test_${i}.wav` });
  assert.deepEqual(writes.map(w => w.text), ['Bình luận 0', 'dragon một', 'dragon hai', 'fruit một', 'fruit hai',
    'lamp một', 'lamp hai', 'lotus một', 'lotus hai', 'Bình luận 1', 'Bình luận 2', 'Bình luận 3']);
  assert.ok((await Promise.all(jobs)).every(result => result.ok)); manager.stop();
});

test('community rate limits do not consume gift budgets; one gift tier cannot fill another', async () => {
  const { manager, writes, reply } = fixture();
  for (let i = 0; i < 20; i++) {
    const promise = manager.synthesize(`Bình luận ${i}`);
    reply({ type: 'result', id: writes.at(-1).id, ok: true, url: '/tts-cache/test.wav' });
    assert.ok((await promise).ok);
  }
  assert.equal((await manager.synthesize('Hết lượt bình luận')).ok, false);
  for (let i = 0; i < 5; i++) {
    const promise = manager.synthesize(`Hoa sen ${i}`, 'maichi', 'lotus');
    reply({ type: 'result', id: writes.at(-1).id, ok: true, url: '/tts-cache/test.wav' });
    assert.ok((await promise).ok);
  }
  assert.equal((await manager.synthesize('Hết lượt hoa sen', 'maichi', 'lotus')).ok, false);
  const gift = manager.synthesize('Quà lớn', 'maichi', 'dragon');
  reply({ type: 'result', id: writes.at(-1).id, ok: true, url: '/tts-cache/test.wav' });
  assert.ok((await gift).ok); manager.stop();
});

test('waiting comments can expire without killing synthesis of the active gift', async () => {
  const { manager, worker, writes, reply } = fixture({ queueTimeoutMs: { community: 10, gift: 1000 } });
  const gift = manager.synthesize('Đang tạo giọng cho quà lớn', 'maichi', 'dragon');
  const comment = await manager.synthesize('Bình luận chờ quá lâu');
  assert.equal(comment.ok, false);
  assert.ok(comment.error.includes('thời gian chờ'));
  assert.equal(manager.queue.length, 0);
  assert.equal(manager.active.tier, 'dragon');
  assert.equal(manager.ready, true); assert.equal(worker.killed, undefined);
  reply({ type: 'result', id: writes[0].id, ok: true, url: '/tts-cache/gift.wav' });
  assert.ok((await gift).ok); manager.stop();
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
