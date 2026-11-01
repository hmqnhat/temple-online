const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('loading old state filters dangerous keys, URLs and settings; shutdown saves atomically', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zane-state-'));
  fs.writeFileSync(path.join(temp, 'merit-state.json'), JSON.stringify({
    totalMerit: 321, tiktok: { connected: true, username: 'should_not_connect' },
    settings: { autoSim: true, autoSimIntervalMs: 1, musicVolume: 999, ttsVoice: '../../file', injected: true },
    devotees: JSON.parse('{"__proto__":{"name":"Evil","merit":99},"constructor":{"name":"Evil"},"minhtam":{"name":"Minh Tâm","merit":100,"avatar":"http://127.0.0.1/private"}}')
  }));
  process.env.APP_DATA_DIR = temp; process.env.PORT = '0'; process.env.ENABLE_TTS = '0';
  process.env.ADMIN_TOKEN = 'state_test_' + 'c'.repeat(40);
  const app = require('../server');
  try {
    const { port } = await app.start();
    const url = `http://127.0.0.1:${port}`;
    const state = await fetch(url + '/api/state').then(res => res.json());
    assert.equal(state.totalMerit, 321);
    assert.equal(state.settings.autoSim, false);
    assert.equal(state.settings.autoSimIntervalMs, 3500);
    assert.equal(state.settings.musicVolume, 1);
    assert.equal(state.settings.ttsVoice, 'maichi');
    assert.equal(state.settings.injected, undefined);
    assert.equal(state.tiktok.username, '');
    assert.equal(state.leaderboard.length, 1);
    assert.equal(state.leaderboard[0].avatar, '');
    assert.equal(Object.prototype.name, undefined);
    const result = await fetch(url + '/rpc', { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'temple.strikeWoodenFish', params: { user: 'Minh Tâm', uniqueId: 'minhtam', count: 1 } }) }).then(res => res.json());
    assert.ok(result.result);
    await app.stop();
    const saved = JSON.parse(fs.readFileSync(path.join(temp, 'merit-state.json'), 'utf8'));
    assert.equal(saved.totalMerit, 322);
    assert.equal(Object.hasOwn(saved.devotees, '__proto__'), false);
    assert.equal(Object.hasOwn(saved.devotees, 'constructor'), false);
    assert.equal(fs.existsSync(path.join(temp, 'merit-state.json.tmp')), false);
  } finally {
    if (app.server.listening) await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
