const crypto = require('node:crypto');

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function validViewerKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 &&
    !DANGEROUS_KEYS.has(value.toLowerCase()) && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeAvatar(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    // Viewer supplied URLs must never cause a browser request into the local network.
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktok.com', 'byteoversea.com', 'ibytedtos.com']
        .some(domain => host.endsWith(`.${domain}`)) ? url.href : '';
  } catch { return ''; }
}

function resolveTikTokUsername(input) {
  if (typeof input !== 'string' || !/^@?[A-Za-z0-9_][A-Za-z0-9._]{0,23}$/.test(input.trim())) {
    throw new Error('Chỉ nhận @username TikTok (1–24 ký tự chữ, số, dấu chấm hoặc gạch dưới); không nhận URL');
  }
  return input.trim().replace(/^@/, '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function validateParams(params) {
  if (!isPlainObject(params)) throw new Error('params phải là object');
  const allowed = new Set(['user', 'uniqueId', 'avatar', 'wish', 'topic', 'count', 'coins', 'giftType',
    'giftName', 'readTts', 'ttsText', 'text', 'voice', 'broadcast', 'comment', 'username', 'enabled',
    'ttsEnabled', 'ttsVoice', 'bgMusicEnabled', 'sfxEnabled', 'smokeDensity', 'autoSim',
    'autoSimIntervalMs', 'musicVolume', 'ttsVolume']);
  for (const [key, value] of Object.entries(params)) {
    if (!allowed.has(key) || DANGEROUS_KEYS.has(key)) throw new Error(`Tham số không hợp lệ: ${key}`);
    if (value !== null && typeof value === 'object') throw new Error(`Tham số ${key} phải là giá trị đơn`);
    if (typeof value === 'string' && value.length > (key === 'avatar' ? 2048 : 500)) {
      throw new Error(`Tham số ${key} quá dài`);
    }
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1000000)) {
      throw new Error(`Tham số ${key} ngoài giới hạn`);
    }
  }
  if (params.uniqueId !== undefined && !validViewerKey(params.uniqueId)) throw new Error('uniqueId không hợp lệ');
  for (const key of ['user', 'wish', 'topic', 'giftType', 'giftName', 'ttsText', 'text', 'voice', 'comment', 'username', 'avatar', 'ttsVoice']) {
    if (params[key] !== undefined && typeof params[key] !== 'string') throw new Error(`${key} phải là chuỗi`);
  }
  for (const key of ['count', 'coins', 'smokeDensity', 'autoSimIntervalMs', 'musicVolume', 'ttsVolume']) {
    if (params[key] !== undefined && typeof params[key] !== 'number') throw new Error(`${key} phải là số`);
  }
  for (const key of ['enabled', 'broadcast', 'readTts', 'ttsEnabled', 'bgMusicEnabled', 'sfxEnabled', 'autoSim']) {
    if (params[key] !== undefined && typeof params[key] !== 'boolean') throw new Error(`${key} phải là boolean`);
  }
}

function createSecurity({ getPort, token = process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString('hex') }) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new Error('ADMIN_TOKEN phải có 32–128 ký tự chữ, số, gạch dưới hoặc gạch ngang');
  }
  const sessions = new Map();
  const buckets = new Map();
  const sameSecret = value => {
    const a = crypto.createHash('sha256').update(String(value || '')).digest();
    const b = crypto.createHash('sha256').update(token).digest();
    return crypto.timingSafeEqual(a, b);
  };
  function originAllowed(req) {
    return req.headers.origin === `http://${req.headers.host}`;
  }
  function allowedRequest(req) {
    const port = getPort();
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (port === 80) { hosts.add('localhost'); hosts.add('127.0.0.1'); }
    return hosts.has(req.headers.host) &&
      (!req.headers.origin || originAllowed(req)) &&
      !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']);
  }
  function allowRate(key, limit, periodMs = 60000) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.until) {
      bucket = { count: 0, until: now + periodMs };
      buckets.set(key, bucket);
    }
    return ++bucket.count <= limit;
  }
  function authorized(req) {
    const bearer = req.headers.authorization;
    if (typeof bearer === 'string' && bearer.startsWith('Bearer ') && sameSecret(bearer.slice(7))) return true;
    if (req.method !== 'GET' && !originAllowed(req)) return false;
    const match = /(?:^|;\s*)temple_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    if (!match) return false;
    const expiry = sessions.get(match[1]);
    if (!expiry || expiry < Date.now()) { sessions.delete(match[1]); return false; }
    return true;
  }
  function guard(req, res, next) {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'no-store', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://*.tiktokcdn.com https://*.tiktokcdn-us.com https://*.tiktokcdn-eu.com https://*.tiktok.com https://*.byteoversea.com https://*.ibytedtos.com; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (!allowedRequest(req)) return res.status(403).json({ error: 'Host hoặc Origin không được phép' });
    next();
  }
  function requireAdmin(req, res, next) {
    if (!authorized(req)) return res.status(401).json({ error: 'Cần đăng nhập quản trị hoặc Bearer token' });
    if (!allowRate('control', 120)) return res.status(429).json({ error: 'Quá nhiều lệnh điều khiển' });
    next();
  }
  function login(req, res) {
    if (!originAllowed(req)) return res.status(403).json({ error: 'Cần đăng nhập từ giao diện cùng Origin' });
    if (!allowRate('login', 5)) return res.status(429).json({ error: 'Thử đăng nhập lại sau một phút' });
    if (typeof req.body?.token !== 'string' || !sameSecret(req.body.token)) return res.status(401).json({ error: 'Mã quản trị không đúng' });
    for (const [id, expiry] of sessions) if (expiry < Date.now()) sessions.delete(id);
    if (sessions.size >= 16) sessions.delete(sessions.keys().next().value);
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(id, Date.now() + 8 * 3600000);
    res.setHeader('Set-Cookie', `temple_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
    res.json({ ok: true });
  }
  function logout(req, res) {
    const match = /(?:^|;\s*)temple_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    if (match) sessions.delete(match[1]);
    res.setHeader('Set-Cookie', 'temple_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  }
  return { token, guard, login, logout, requireAdmin, authorized, allowedRequest, originAllowed, allowRate };
}

module.exports = { createSecurity, validViewerKey, safeAvatar, resolveTikTokUsername, validateParams, isPlainObject };
