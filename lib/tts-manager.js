const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { TIERS, LaneQueue } = require('../public/js/ritual-queue');

class ZeroTTSManager {
  constructor({ enabled = process.env.ENABLE_TTS === '1', spawnWorker = spawn,
    timeoutMs = 180000, loadTimeoutMs = 120000,
    queueTimeoutMs = { community: 30000, gift: 120000 }, onStatus = () => {} } = {}) {
    this.proc = null;
    this.ready = false;
    this.status = 'disabled';
    this.voice = 'maichi';
    this.voices = ['maichi'];
    this.model = 'zeroweight-ai/ZeroTTS@18d6681518a4becaed3c125ceb3c7db59905fe86';
    this.queue = new LaneQueue();
    this.active = null;
    this.inflight = new Map();
    this.reqCounter = 0;
    this.buffer = '';
    this.timeoutMs = timeoutMs;
    this.queueTimeoutMs = queueTimeoutMs;
    this.onStatus = onStatus;
    this.rates = Object.fromEntries(TIERS.map(tier => [tier, { start: Date.now(), count: 0 }]));
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
      voices: this.voices, model: this.model, queued: this.queue.length,
      queuedByTier: this.queue.counts(), activeTier: this.active?.tier || null };
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
      if (msg.ok && msg.durationMs != null && (!Number.isFinite(msg.durationMs) || msg.durationMs <= 0 || msg.durationMs > 60000)) {
        msg = { ok: false, error: "audio_duration_limit" };
      }
      msg = this.result(msg);
      clearTimeout(this.active.timer);
      this.active.resolve(msg);
      this.active = null;
      this.pump();
    }
  }

  result(msg) {
    const ok = msg.ok === true;
    return { normalizedText: '', chunkCount: 0, normalizationVersion: 'v6-paragraph-pauses-1', ...msg,
      ok, status: ok ? 'ready' : (msg.errorCode === 'disabled' ? 'disabled' : 'failed'),
      url: ok ? msg.url : null, durationMs: ok ? (msg.durationMs ?? null) : null,
      error: ok ? null : (msg.error || 'Synthesis failed'),
      errorCode: ok ? null : (msg.errorCode || msg.error || 'synthesis_failed') };
  }

  synthesize(text, voice = 'maichi', tier = 'community') {
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 320) return Promise.resolve(this.result({ ok: false, error: 'TTS chỉ nhận 1–320 ký tự', errorCode: 'invalid_text' }));
    if (typeof voice !== 'string' || !this.voices.includes(voice)) return Promise.resolve(this.result({ ok: false, error: 'Giọng đọc không hợp lệ', errorCode: 'invalid_voice' }));
    if (!TIERS.includes(tier)) return Promise.resolve(this.result({ ok: false, error: 'Tầng ưu tiên không hợp lệ', errorCode: 'invalid_tier' }));
    if (!this.proc || !this.ready) return Promise.resolve(this.result({ ok: false, error: `ZeroTTS: ${this.status}`, errorCode: this.status }));
    const key = `${tier}::${voice}::${text.trim()}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.queue.lanes[tier].length + (this.active?.tier === tier ? 1 : 0) >= 4) {
      return Promise.resolve(this.result({ ok: false, error: `Hàng đợi TTS ${tier} đã đầy`, errorCode: "queue_full" }));
    }
    const rate = this.rates[tier], limit = tier === 'community' ? 20 : 5;
    if (Date.now() - rate.start >= 60000) { rate.start = Date.now(); rate.count = 0; }
    if (rate.count >= limit) return Promise.resolve(this.result({ ok: false, error: `Giới hạn ${limit} câu TTS/phút cho ${tier}`, errorCode: "rate_limit" }));
    rate.count++;
    const promise = new Promise(resolve => {
      const entry = { id: ++this.reqCounter, text: text.trim(), voice, tier, resolve };
      // An expired waiting comment must not kill synthesis of a donor's gift.
      entry.timer = setTimeout(() => {
        this.queue.remove(item => item === entry);
        resolve(this.result({ ok: false, error: 'TTS hết thời gian chờ', errorCode: "queue_timeout" }));
      }, tier === 'community' ? this.queueTimeoutMs.community : this.queueTimeoutMs.gift);
      this.queue.push(entry);
      this.pump();
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  pump() {
    if (this.active || !this.ready || !this.proc || !this.queue.length) return;
    this.active = this.queue.shift();
    clearTimeout(this.active.timer);
    this.active.timer = setTimeout(() => this.stop('synthesis-timeout'), this.timeoutMs);
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
    for (const entry of [this.active, ...this.queue.remove(() => true)].filter(Boolean)) {
      clearTimeout(entry.timer);
      entry.resolve(this.result({ ok: false, error: `ZeroTTS: ${this.status}`, errorCode: this.status }));
    }
    this.active = null;
    this.inflight.clear();
    if (proc) proc.kill('SIGKILL'); // A timeout must actually cancel Python/native synthesis.
    this.onStatus(this.getStatus());
  }
}

module.exports = { ZeroTTSManager };
