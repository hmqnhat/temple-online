// Invoked only by run-isolated-audit.py with fake data and a macOS sandbox profile.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [secret, outsideWrite, forbiddenPort, output] = process.argv.slice(2);
const checks = {};
const activity = [];
function observe(operation, target) {
  if (activity.length < 5000) activity.push({ operation, target: String(target).slice(0, 300) });
}
function expectDenied(name, action) {
  try { action(); checks[name] = { denied: false }; }
  catch (error) { checks[name] = { denied: ['EPERM', 'EACCES'].includes(error.code), code: error.code }; }
}
(async () => {
  expectDenied('readFakeSecretOutsideAllowlist', () => fs.readFileSync(secret));
  expectDenied('writeOutsideWorkDirectory', () => fs.writeFileSync(outsideWrite, 'fake'));
  const child = spawnSync('/usr/bin/true');
  checks.spawnChildProcess = { denied: ['EPERM', 'EACCES'].includes(child.error?.code), code: child.error?.code };
  checks.connectOutsideAllowedPort = await new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(forbiddenPort) });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve({ denied: false }); });
    socket.once('timeout', () => { socket.destroy(); resolve({ denied: false, code: 'TIMEOUT_UNPROVEN' }); });
    socket.once('error', error => resolve({ denied: ['EPERM', 'EACCES'].includes(error.code), code: error.code }));
  });
  // Supplemental JS tracing; native code can bypass hooks. The OS policy remains separate.
  for (const name of ['readFileSync', 'readFile', 'openSync', 'open', 'writeFileSync', 'writeFile']) {
    const original = fs[name];
    fs[name] = function (target, ...args) { observe(`fs.${name}`, target); return original.call(this, target, ...args); };
  }
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    observe('net.connect', typeof options === 'object' ? `${options.host || 'localhost'}:${options.port || options.path}` : options);
    return connect.apply(this, args);
  };
  const app = require('../server'); // Real installed Express/ws/TikTok dependency code; no fake connector.
  try {
    const { port } = await app.start();
    const origin = `http://127.0.0.1:${port}`;
    const initial = await fetch(origin + '/api/state').then(res => res.json());
    const result = await fetch(origin + '/rpc', { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'temple.burnIncense',
        params: { user: 'Isolation Test', uniqueId: 'isolation_test', count: 3, readTts: false } }) }).then(res => res.json());
    checks.realApplication = { passed: Boolean(result.result?.event), ttsStatus: initial.tts.status,
      tiktokConnected: initial.tiktok.connected, boundAddress: app.server.address().address,
      playwrightLoaded: Object.keys(require.cache).some(file => file.includes('/playwright-core/')) };
  } finally { await app.stop(); }
  checks.observedJavascriptActivity = activity;
  fs.writeFileSync(output, JSON.stringify(checks, null, 2));
  const denied = Object.entries(checks).filter(([name]) => !['realApplication', 'observedJavascriptActivity'].includes(name)).every(([, value]) => value.denied);
  if (!denied || !checks.realApplication.passed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
