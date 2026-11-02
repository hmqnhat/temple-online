const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadEdition, FortuneDeck, DEFAULT_DIR } = require('../lib/fortunes');

const edition = loadEdition();
function seeded(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

test('production edition is the complete CTC set with original ranks, sources and no composed text', () => {
  assert.equal(edition.records.length, 100);
  assert.deepEqual({ ...edition.rankCounts }, { upper: 34, middle: 46, lower: 20 });
  const raw = JSON.parse(fs.readFileSync(path.join(DEFAULT_DIR, 'source.json'), 'utf8'));
  edition.records.forEach((r, i) => {
    assert.equal(r.number, i + 1);
    assert.equal(r.id, `ctc-guanyin-100:${raw.edition}:${i + 1}`);
    assert.equal(r.original.poem.split('\n').length, 4);
    assert.equal(r.original.gloss.split('\n').length, 4);
    assert.match(r.source.url, /^https:\/\/www\.ctc\.org\.hk\/chim\//);
    assert.equal(r.source.accessedAt, '2026-11-02');
    assert.equal(r.vietnamese.poemTranslation.split('\n').length, 4, 'reviewed Vietnamese verse, four lines');
    assert.equal(r.vietnamese.poemHanViet.split('\n').length, 4);
    assert.ok(!/[\u3400-\u9fff]/.test(JSON.stringify(r.vietnamese)), `Chinese character left in Vietnamese text ${r.number}`);
    assert.equal(r.vietnamese.reviewStatus, 'reviewed_with_traditional_poetry');
    assert.equal(r.vietnamese.reviewLabel, 'Bản dịch thơ đã được duyệt');
    assert.notEqual(r.vietnamese.summary, r.original.gloss);
    assert.equal(r.ttsSummary, `Quẻ số ${r.number}, ${r.vietnamese.rank === 'Thượng' ? 'quẻ thượng' : r.vietnamese.rank === 'Trung' ? 'quẻ trung' : 'quẻ hạ'}.\n${r.vietnamese.title}.\n\n${r.vietnamese.poemTranslation.split('\n').join(' ')}`);
    assert.ok(r.ttsSummary.length <= 210, `tts too long ${r.number}`);
    assert.equal(r.original.rank, raw.records[i].rankOriginal);
  });
  // Spot facts independently read from the publisher pages in the audit.
  assert.equal(edition.records[23].original.rank, '下籤'); assert.equal(edition.records[23].original.title, '殷郊遇師');
  assert.equal(edition.records[35].original.rank, '中籤'); assert.equal(edition.records[98].original.title, '陶三春掛帥');
  assert.equal(edition.records[0].vietnamese.rank, 'Thượng'); assert.equal(edition.records[98].vietnamese.rank, 'Hạ');
});

test('validator rejects partial, duplicated, unsourced or unverified datasets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fortune-validate-'));
  const source = JSON.parse(fs.readFileSync(path.join(DEFAULT_DIR, 'source.json'), 'utf8'));
  const vi = JSON.parse(fs.readFileSync(path.join(DEFAULT_DIR, 'vi.json'), 'utf8'));
  function attempt(mutate) {
    const s = structuredClone(source), v = structuredClone(vi);
    mutate(s, v);
    const dir = fs.mkdtempSync(path.join(root, 'd-'));
    fs.writeFileSync(path.join(dir, 'source.json'), JSON.stringify(s)); fs.writeFileSync(path.join(dir, 'vi.json'), JSON.stringify(v));
    return () => loadEdition(dir);
  }
  assert.doesNotThrow(attempt(() => {}));
  assert.throws(attempt(s => { s.records.pop(); }), /fortune_count_mismatch/);
  assert.throws(attempt(s => { s.records[5].number = 5; }), /fortune_number_invalid/);
  assert.throws(attempt(s => { s.records[1].rank = 'upper'; }), /fortune_rank_counts_mismatch/);
  assert.throws(attempt(s => { s.records[1].rank = 'divine'; }), /fortune_rank_invalid:2/);
  assert.throws(attempt(s => { s.records[2].sourceUrl = 'https://example.com/x'; }), /fortune_source_missing:3/);
  assert.throws(attempt(s => { s.records[3].verification = 'unverified'; }), /fortune_unverified:4/);
  assert.throws(attempt(s => { s.records[4].originalPoem.pop(); }), /fortune_poem_invalid:5/);
  assert.throws(attempt(s => { s.records[4].originalGloss[0] = ' '; }), /fortune_gloss_invalid:5/);
  assert.throws(attempt((s, v) => { v.records[6].glossVi = ''; }), /fortune_translation_missing:7/);
  assert.throws(attempt((s, v) => { v.records[7].poemVi.pop(); }), /fortune_poem_vi_invalid:8/);
  assert.throws(attempt((s, v) => { v.records[8].poemVi[2] = ' '; }), /fortune_poem_vi_invalid:9/);
  assert.throws(attempt((s, v) => { delete v.records[9].poemHanViet; }), /fortune_poem_hanviet_invalid:10/);
  assert.throws(attempt((s, v) => { v.status = 'trusted'; }), /fortune_translation_status_invalid/);
  assert.throws(attempt((s, v) => { v.records.pop(); }), /fortune_translation_incomplete/);
  assert.throws(attempt((s, v) => { v.collectionId = 'other'; }), /fortune_collection_mismatch/);
});

test('draws without replacement per cycle, reshuffles at the boundary and never repeats across it', () => {
  for (const seed of [1, 7, 99, 12345]) {
    const deck = new FortuneDeck(edition, { rng: seeded(seed) });
    let previous = null;
    for (let cycle = 1; cycle <= 4; cycle++) {
      const seen = new Set();
      for (let i = 0; i < 100; i++) {
        const number = deck.draw(null).number;
        assert.ok(!seen.has(number), `repeat inside cycle ${cycle}`);
        assert.notEqual(number, previous, 'repeat across cycle boundary');
        seen.add(number); previous = number;
      }
      assert.equal(seen.size, 100);
    }
  }
});

test('same seed repeats exactly; a degenerate rng cannot break the deck', () => {
  const run = seed => { const d = new FortuneDeck(edition, { rng: seeded(seed) }); return Array.from({ length: 120 }, () => d.draw('a').number); };
  assert.deepEqual(run(5), run(5)); assert.notDeepEqual(run(5), run(6));
  const bad = new FortuneDeck(edition, { rng: () => NaN });
  assert.equal(new Set(Array.from({ length: 100 }, () => bad.draw(null).number)).size, 100);
});

test('one person drawing many times and many people share the cycle without recent repeats', () => {
  const deck = new FortuneDeck(edition, { rng: seeded(42) });
  const mine = Array.from({ length: 250 }, () => deck.draw('viewer_a').number);
  for (let i = 0; i < mine.length; i++) for (let j = Math.max(0, i - 10); j < i; j++) assert.notEqual(mine[i], mine[j], 'recent repeat for one person');
  const crowd = new FortuneDeck(edition, { rng: seeded(3) });
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(crowd.draw(`p${i}`).number);
  assert.equal(seen.size, 100, 'different people take distinct cards in one cycle');
});

test('history and persistence are bounded; hostile saved data falls back safely', () => {
  const deck = new FortuneDeck(edition, { rng: seeded(8), maxPeople: 50, recentPerPerson: 5 });
  for (let i = 0; i < 390; i++) deck.draw(`p${i}`);
  assert.ok(deck.history.size <= 50);
  assert.ok(deck.serialize().history.every(([, n]) => n.length <= 5));
  const copy = new FortuneDeck(edition, { rng: seeded(99), maxPeople: 50, recentPerPerson: 5 });
  assert.equal(copy.restore(JSON.parse(JSON.stringify(deck.serialize()))), true);
  assert.deepEqual(copy.remaining, deck.remaining); assert.equal(copy.draw('x').number, deck.draw('x').number);
  const hostile = [null, {}, { collectionId: 'x', remaining: [] }, { collectionId: edition.collectionId, remaining: [1, 1] },
    { collectionId: edition.collectionId, remaining: [101] }, { collectionId: edition.collectionId, remaining: new Array(101).fill(1) },
    { collectionId: edition.collectionId, remaining: ['1'] }];
  for (const saved of hostile) {
    const fresh = new FortuneDeck(edition, { rng: seeded(1) }); const before = [...fresh.remaining];
    assert.equal(fresh.restore(saved), false); assert.deepEqual(fresh.remaining, before);
  }
  const partial = new FortuneDeck(edition, { rng: seeded(1) });
  assert.equal(partial.restore({ collectionId: edition.collectionId, remaining: [4, 9], history: [['__proto__', [1]], 5, ['ok', [1, 'x', 500]]], last: 'bad' }), true);
  assert.equal(partial.draw(null).number, 9); assert.equal(partial.draw(null).number, 4);
  assert.equal(partial.last, 4); assert.deepEqual(partial.history.get('ok'), [1]);
  partial.reset(); assert.equal(partial.remaining.length, 100); assert.equal(partial.history.size, 0);
});

test('importer parses the publisher page structure and refuses malformed pages', () => {
  const page = `<div class="txt-grp txt-grp1">
 <div class="txt"><span>第一籤</span><span>上籤</span><span>古人</span><span>鍾離成道</span></div>
 </div>
 <div class="txt-grp txt-grp2"><div class="txt"><span>甲甲甲甲甲甲甲<br /></span><span>乙乙乙乙乙乙乙<br /></span></div><div class="txt"><span>丙丙丙丙丙丙丙<br /></span><span>丁丁丁丁丁丁丁</span></div></div>
 <div class="txt-grp txt-grp3"><div class="txt-meaning">解曰</div><div class=""><div class="txt"><span>一一一一<br /></span><span>二二二二<br /></span></div><div class="txt"><span>三三三三<br /></span><span>四四四四</span></div></div></div></div>`;
  const run = html => spawnSync('python3', ['-I', '-c', `
import sys,importlib.util,json
sp=importlib.util.spec_from_file_location('imp','scripts/import-fortunes.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
print(json.dumps(m.parse(int(sys.argv[1]),sys.stdin.read()),ensure_ascii=False))`, '1'], { input: html, encoding: 'utf8', cwd: path.join(__dirname, '..') });
  const ok = run(page);
  assert.equal(ok.status, 0, ok.stderr);
  const record = JSON.parse(ok.stdout);
  assert.equal(record.rank, 'upper'); assert.equal(record.originalPoem.length, 4); assert.equal(record.originalGloss[3], '四四四四');
  assert.equal(record.sourceUrl, 'https://www.ctc.org.hk/chim/觀音籤-第一籤/');
  assert.notEqual(run(page.replace('上籤', '神籤')).status, 0);
  assert.notEqual(run(page.replace('第一籤', '第二籤')).status, 0);
  assert.notEqual(run(page.replace('<span>丁丁丁丁丁丁丁</span>', '')).status, 0);
  assert.notEqual(run('<html></html>').status, 0);
});

test('actual server: fortune choice ignores coins/topic, persists the cycle across restart and resets with the session store', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zane-fortune-'));
  process.env.APP_DATA_DIR = temp; process.env.PORT = '0'; process.env.ENABLE_TTS = '0';
  process.env.ADMIN_TOKEN = 'fortune_test_' + 'd'.repeat(40);
  const app = require('../server');
  const call = async (url, method, params) => (await fetch(url + '/rpc', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(r => r.json()));
  const { port } = await app.start(); const url = `http://127.0.0.1:${port}`;
  const drawn = [];
  for (let i = 0; i < 12; i++) {
    const wish = i % 2 ? 'xin tài lộc' : 'xin sức khỏe';
    const res = await call(url, 'temple.drawFortune', { user: 'Nguyễn Thị Thanh Tâm', uniqueId: `fortune_viewer_${i % 3}`, topic: wish });
    assert.ok(res.result, JSON.stringify(res));
    const { event } = res.result, f = event.fortune;
    drawn.push(f.number);
    assert.equal(f.collectionId, 'ctc-guanyin-100');
    assert.ok(f.original.poem && f.original.rank && f.source.url && f.vietnamese.summary && f.vietnamese.poemTranslation.split('\n').length === 4);
    assert.equal(event.ttsText, `Thí chủ ${event.user} vừa gieo được ${f.ttsSummary}`);
    assert.ok([...event.ttsText].length <= 320);
  }
  assert.equal(new Set(drawn).size, 12, 'no repeat inside the cycle');
  // A long 64-scalar accented name still produces speech text inside the TTS limit.
  const longName = 'Nguyễn Thị Thanh Tâm Hoàng Minh Ngọc An Phúc Bảo Châu Thiện Từ Ý';
  assert.ok([...`Thí chủ ${longName} vừa gieo được ${edition.records.reduce((a, b) => b.ttsSummary.length > a.ttsSummary.length ? b : a).ttsSummary}`].length <= 320);
  await app.stop();
  const saved = JSON.parse(fs.readFileSync(path.join(temp, 'merit-state.json'), 'utf8'));
  assert.equal(saved.fortuneDeck.remaining.length, 88);
  assert.ok(saved.fortuneDeck.history.length <= 3);
  for (const n of drawn) assert.ok(!saved.fortuneDeck.remaining.includes(n));
});
