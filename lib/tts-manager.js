const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

class ZeroTTSManager {
  constructor({ enabled = process.env.ENABLE_TTS === '1', spawnWorker = spawn,
    timeoutMs = 30000, loadTimeoutMs = 120000, onStatus = () => {} } = {}) {
    this.proc = null;
    this.ready = false;
    this.status = 'disabled';
    this.voice = 'maichi';
    this.voices = ['maichi'];
    this.model = 'zeroweight-ai/ZeroTTS@18d6681518a4becaed3c125ceb3c7db59905fe86';
    this.queue = [];
    this.active = null;
    this.inflight = new Map();
    this.reqCounter = 0;
    this.buffer = '';
    this.timeoutMs = timeoutMs;
    this.onStatus = onStatus;
    this.rate = { start: Date.now(), count: 0 };
    if (!enabled) return;
    const root = path.resolve(__dirname, '..');
    const dataDir = path.resolve(process.env.APP_DATA_DIR || path.join(root, 'data'));
    const python = path.join(root, '.venv', 'bin', 'python');
    if (!fs.existsSync(python) && spawnWorker === spawn) { this.status = 'missing-venv'; return; }
    this.status = 'loading';
    this.proc = spawnWorker(python, ['-u', path.join(root, 'tts_worker.py')], {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'en_US.UTF-8',
        PYTHONNOUSERSITE: '1', HF_HOME: path.join(dataDir, 'model-cache'), APP_DATA_DIR: dataDir,
        ZEROTTS_VOICES_HOME: path.join(dataDir, 'voices'),
        HF_HUB_DISABLE_IMPLICIT_TOKEN: '1', HF_HUB_DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1',
        TTS_ALLOW_MODEL_DOWNLOAD: process.env.TTS_ALLOW_MODEL_DOWNLOAD === '1' ? '1' : '0' }
    });
    this.loadTimer = setTimeout(() => this.stop('load-timeout'), loadTimeoutMs);
    this.proc.stdout.on('data', chunk => {
      this.buffer += chunk.toString('utf8');
      if (this.buffer.length > 65536) return this.stop('invalid-worker-output');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) this.handleWorkerLine(line);
    });
    this.proc.stderr.on('data', chunk => console.warn('[ZeroTTS]', chunk.toString('utf8').slice(0, 2000).trim()));
    this.proc.stdin.on('error', () => this.stop('worker-input-error'));
    this.proc.on('error', () => this.stop('worker-error'));
    this.proc.on('exit', () => this.stop(this.status === 'loading' ? 'load-failed' : 'stopped'));
  }

  getStatus() {
    return { ready: this.ready, status: this.status, engine: 'ZeroTTS', voice: this.voice,
      voices: this.voices, model: this.model, queued: this.queue.length };
  }

  handleWorkerLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (!this.proc || !msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.type === 'ready') {
      clearTimeout(this.loadTimer);
      this.ready = true;
      this.status = 'ready';
      this.voices = Array.isArray(msg.voices) ? msg.voices.filter(v => typeof v === 'string' && /^[a-z0-9_-]{1,40}$/.test(v)) : ['maichi'];
      this.onStatus(this.getStatus());
      this.pump();
    } else if (msg.type === 'error') {
      this.stop('worker-error');
    } else if (msg.type === 'result' && this.active?.id === msg.id) {
      if (msg.ok && (typeof msg.url !== 'string' || !/^\/tts-cache\/[a-z0-9_-]+\.wav$/.test(msg.url))) {
        msg = { ok: false, error: 'Invalid audio URL' };
      }
      clearTimeout(this.active.timer);
      this.active.resolve(msg);
      this.active = null;
      this.pump();
    }
  }

  synthesize(text, voice = 'maichi') {
    if (typeof text !== 'string' || !text.trim() || text.length > 320) return Promise.resolve({ ok: false, error: 'TTS chỉ nhận 1–320 ký tự' });
    if (typeof voice !== 'string' || !this.voices.includes(voice)) return Promise.resolve({ ok: false, error: 'Giọng đọc không hợp lệ' });
    if (!this.proc || !this.ready) return Promise.resolve({ ok: false, error: `ZeroTTS: ${this.status}` });
    const key = `${voice}::${text.trim()}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.queue.length + (this.active ? 1 : 0) >= 4) return Promise.resolve({ ok: false, error: 'Hàng đợi TTS đã đầy' });
    if (Date.now() - this.rate.start >= 60000) this.rate = { start: Date.now(), count: 0 };
    if (++this.rate.count > 20) return Promise.resolve({ ok: false, error: 'Giới hạn 20 câu TTS/phút' });
    const promise = new Promise(resolve => {
      const entry = { id: ++this.reqCounter, text: text.trim(), voice, resolve };
      entry.timer = setTimeout(() => this.stop('synthesis-timeout'), this.timeoutMs);
      this.queue.push(entry);
      this.pump();
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  pump() {
    if (this.active || !this.ready || !this.proc || !this.queue.length) return;
    this.active = this.queue.shift();
    const { id, text, voice } = this.active;
    try { this.proc.stdin.write(JSON.stringify({ id, text, voice }) + '\n'); }
    catch { this.stop('worker-input-error'); }
  }

  stop(status = 'stopped') {
    const proc = this.proc;
    this.proc = null;
    this.ready = false;
    // Retain the reason when the subsequent process exit event arrives.
    if (proc || this.status === 'loading') this.status = status;
    clearTimeout(this.loadTimer);
    for (const entry of [this.active, ...this.queue].filter(Boolean)) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: `ZeroTTS: ${this.status}` });
    }
    this.active = null;
    this.queue = [];
    this.inflight.clear();
    if (proc) proc.kill('SIGKILL'); // A timeout must actually cancel Python/native synthesis.
    this.onStatus(this.getStatus());
  }
}

module.exports = { ZeroTTSManager };
