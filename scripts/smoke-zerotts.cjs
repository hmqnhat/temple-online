// Real, offline TTS through the app's HTTP API. Python runs in macOS Seatbelt.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawn, execFileSync } = require('node:child_process');
const { ZeroTTSManager } = require('../lib/tts-manager');

const root = path.resolve(__dirname, '..');
const data = path.join(root, 'data');
const samples = path.join(data, 'tts-samples');
const reportFile = path.join(root, 'docs/security/zerotts-runtime-test.json');
fs.mkdirSync(samples, { recursive: true });
fs.mkdirSync(path.join(data, 'tts-cache'), { recursive: true });
const installation = JSON.parse(fs.readFileSync(path.join(root, 'docs/security/zerotts-model-install.json')));
assert.ok(installation.downloaded && installation.verifiedFiles === installation.files.length, 'Run setup-zerotts.py first');

const python = fs.realpathSync(path.join(root, '.venv/bin/python'));
const profile = [
  '(version 1)', '(allow default)',
  '(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders"))',
  '(allow file-read-metadata)',
  `(allow file-read* (subpath ${JSON.stringify(root)}) (subpath ${JSON.stringify(path.resolve(python, '../..'))}) (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/private/etc") (subpath "/private/var/db/timezone") (subpath "/dev"))`,
  '(deny file-write*)', `(allow file-write* (subpath ${JSON.stringify(path.join(data, 'tts-cache'))}) (literal "/dev/null"))`,
  '(deny network*)', '(deny process-fork)', ''
].join('\n');
const profilePath = path.join(samples, 'worker-offline.sb');
fs.writeFileSync(profilePath, profile);

process.env.APP_DATA_DIR = data;
process.env.PORT = '0';
process.env.ENABLE_TTS = '1';
process.env.TTS_ALLOW_MODEL_DOWNLOAD = '0';
process.env.ADMIN_TOKEN = crypto.randomBytes(32).toString('hex');
let worker;
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === './lib/tts-manager' && args[0]?.filename === path.join(root, 'server.js')) {
    return { ZeroTTSManager: class extends ZeroTTSManager {
      constructor(options) {
        super({ ...options, enabled: true, spawnWorker: (bin, workerArgs, opts) =>
          spawn('/usr/bin/sandbox-exec', ['-f', profilePath, bin, ...workerArgs], opts) });
        worker = this;
      }
    } };
  }
  return load.call(this, id, ...args);
};
const app = require('../server');
Module._load = load;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function rssMiB() {
  const value = execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(worker.proc.pid)], { encoding: 'utf8' }).trim();
  return Math.round(Number(value) / 1024 * 10) / 10;
}
function inspectWav(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let format, audio;
  for (let at = 12; at + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', at, at + 4), length = bytes.readUInt32LE(at + 4);
    const begin = at + 8;
    assert.ok(begin + length <= bytes.length);
    if (tag === 'fmt ') format = { type: bytes.readUInt16LE(begin), channels: bytes.readUInt16LE(begin + 2),
      sampleRate: bytes.readUInt32LE(begin + 4), bits: bytes.readUInt16LE(begin + 14) };
    if (tag === 'data') audio = bytes.subarray(begin, begin + length);
    at = begin + length + length % 2;
  }
  assert.ok(format && audio);
  assert.equal(format.type, 1); assert.equal(format.channels, 1);
  assert.equal(format.bits, 16); assert.equal(format.sampleRate, 48000);
  let peak = 0, sum = 0;
  for (let at = 0; at < audio.length; at += 2) {
    const value = audio.readInt16LE(at) / 32768;
    peak = Math.max(peak, Math.abs(value)); sum += value * value;
  }
  assert.ok(peak > 0.001 && peak < 0.91);
  return { ...format, bytes: bytes.length, durationSec: audio.length / 2 / format.sampleRate,
    peak, rms: Math.sqrt(sum / (audio.length / 2)) };
}

(async () => {
  const report = { testedUtc: new Date().toISOString(), revision: installation.revision,
    offlineWorkerSandbox: true, tiktokConnected: false, samples: [] };
  try {
    const started = performance.now();
    const { port } = await app.start();
    const origin = `http://127.0.0.1:${port}`;
    while (!worker.ready && performance.now() - started < 125000) {
      if (!worker.proc) throw new Error(`TTS startup failed: ${worker.status}`);
      await delay(100);
    }
    assert.ok(worker.ready, 'TTS not ready');
    report.loadWallSec = (performance.now() - started) / 1000;
    report.voices = worker.voices;
    report.workerRssReadyMiB = rssMiB();
    const request = text => fetch(origin + '/rpc', { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'temple.speak',
        params: { text, voice: 'maichi', broadcast: false } }) }).then(res => res.json());
    const texts = [
      'Xin chào các bạn. Đây là giọng đọc Mai Chi đang chạy trực tiếp trên máy.',
      'Cảm ơn Minh Tâm đã ủng hộ người phát triển và vận hành buổi livestream.'
    ];
    for (let i = 0; i < texts.length; i++) {
      const t0 = performance.now();
      const response = await request(texts[i]);
      assert.ok(response.result?.ok, JSON.stringify(response));
      const result = response.result;
      const file = path.join(samples, `maichi-${i + 1}.wav`);
      fs.copyFileSync(path.join(data, 'tts-cache', result.file), file);
      const audioResponse = await fetch(origin + result.url);
      assert.equal(audioResponse.status, 200);
      assert.ok((await audioResponse.arrayBuffer()).byteLength > 200);
      report.samples.push({ text: texts[i], file, cached: result.cached, apiWallSec: (performance.now() - t0) / 1000,
        synthSec: result.synthSec, workerRssAfterMiB: rssMiB(), audio: inspectWav(file) });
    }
    const cached = await request(texts[0]);
    assert.ok(cached.result?.ok && cached.result.cached, 'Cache hit failed');
    report.cacheHitPassed = true;
    report.passed = true;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.passed = false; report.error = error.message;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    throw error;
  } finally { await app.stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
