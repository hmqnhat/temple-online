// Optional real-browser smoke test: uses a fresh Chrome profile and no TikTok/TTS connection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zane-browser-'));
const token = 'browser_test_' + 'b'.repeat(40);
process.env.APP_DATA_DIR = temp;
process.env.PORT = '0';
process.env.ENABLE_TTS = '0';
process.env.ADMIN_TOKEN = token;
const app = require('../server');

(async () => {
  let browser;
  try {
    const { port } = await app.start();
    const origin = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const errors = [];
    const policyViolations = [];
    async function context() {
      const ctx = await browser.newContext();
      await ctx.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      await ctx.exposeFunction('reportPolicyViolation', directive => policyViolations.push(directive));
      await ctx.addInitScript(() => document.addEventListener('securitypolicyviolation', event => window.reportPolicyViolation(event.violatedDirective)));
      ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      return ctx;
    }
    const adminContext = await context();
    const admin = await adminContext.newPage();
    await admin.goto(origin + '/admin');
    await admin.waitForFunction(() => document.querySelector('#statusBanner').textContent.includes('disabled'));
    await admin.locator('#action0').click();
    await admin.locator('dialog[open]').waitFor();
    await admin.locator('dialog input').fill('wrong');
    await admin.locator('dialog button[type=submit]').click();
    await admin.getByText('Mã quản trị không đúng', { exact: true }).waitFor();
    await admin.locator('dialog input').fill(token);
    await admin.locator('dialog button[type=submit]').click();
    await admin.locator('dialog').waitFor({ state: 'hidden' });
    await admin.waitForFunction(() => document.querySelector('#rpcOutput').textContent.includes('burnIncense'));
    const cookie = (await adminContext.cookies()).find(cookie => cookie.name === 'temple_session');
    assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict');
    assert.ok(!JSON.stringify(await admin.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).includes(token));

    const overlayContext = await context();
    const overlay = await overlayContext.newPage();
    const overlayWrites = [];
    overlay.on('request', req => { if (req.method() !== 'GET') overlayWrites.push(req.url()); });
    const wsReady = overlay.waitForEvent('websocket');
    await overlay.goto(origin + '/?obs=1');
    const ws = await wsReady;
    // Wait for the read-only connection's initial state frame before triggering events.
    await overlay.waitForFunction(() => document.body.classList.contains('obs-mode'));
    assert.equal(await overlay.getByText('Đăng nhập quản trị', { exact: true }).count(), 0);
    const received = ws.waitForEvent('framereceived', { predicate: frame => String(frame.payload).includes('drawFortune') });
    await admin.locator('#action4').click();
    await received;
    await overlay.locator('#fortuneModal.visible').waitFor();
    assert.deepEqual(overlayWrites, []);
    assert.equal((await overlay.evaluate(() => window.templeRpc('temple.resetMerit'))).error.message, 'Overlay chỉ nhận sự kiện');
    assert.deepEqual(overlayWrites, []);

    const invoke = (method, params) => admin.evaluate(async ({ method, params }) => {
      const response = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }) });
      return response.json();
    }, { method, params });
    assert.ok((await invoke('temple.offerGift', { user: 'Quà nhỏ', coins: 1 })).result);
    await overlay.waitForFunction(() => document.querySelector('#centralName').textContent === 'Quà nhỏ');
    assert.ok((await invoke('temple.offerGift', { user: 'Quà lớn một', coins: 100 })).result);
    await overlay.waitForFunction(() => document.querySelector('#centralName').textContent === 'Quà lớn một');
    assert.equal(await overlay.locator('#fortuneModal.visible').count(), 0);
    assert.ok((await invoke('temple.offerGift', { user: 'Quà lớn hai', coins: 200 })).result);
    for (let i = 0; i < 20; i++) {
      assert.ok((await invoke('temple.comment', { user: `Người xem ${i}`, uniqueId: `flood_${i}`,
        comment: 'Cầu gia đình bình an' })).result);
    }
    assert.equal(await overlay.locator('#centralName').textContent(), 'Quà lớn một');
    await overlay.waitForFunction(() => document.querySelector('#centralName').textContent === 'Quà lớn hai');
    await overlay.waitForFunction(() => document.querySelector('#centralName').textContent === 'Quà nhỏ');
    assert.deepEqual(overlayWrites, []);

    const live = await adminContext.newPage();
    await live.goto(origin + '/');
    const state = await live.evaluate(() => fetch('/api/state').then(res => res.json()));
    await live.locator('#btnRpcWoodenFish').click();
    await live.waitForFunction(async previous => (await fetch('/api/state').then(res => res.json())).woodenFishHits > previous, state.woodenFishHits);
    assert.equal(await live.locator('dialog[open]').count(), 0);
    await admin.reload();
    await admin.locator('#action2').click();
    await admin.waitForFunction(() => document.querySelector('#rpcOutput').textContent.includes('strikeWoodenFish'));
    await admin.getByText('Đăng xuất', { exact: true }).click();
    await admin.getByText('Đã đăng xuất', { exact: true }).waitFor();
    await admin.locator('#action0').click();
    await admin.locator('dialog[open]').waitFor();
    await admin.getByText('Hủy', { exact: true }).click();
    assert.deepEqual(errors, []);
    assert.deepEqual(policyViolations, []);
    console.log('PASS browser: login/retry, HttpOnly session, reload, logout, quick controls, read-only OBS, fortune animation, gifts preempt comments, comment flood cannot overwrite donors, equal-tier FIFO, interrupted gift resumes, CSP, no JavaScript errors');
  } finally {
    if (browser) await browser.close();
    await app.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
