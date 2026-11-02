'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DIR = path.join(__dirname, '..', 'content', 'fortunes', 'ctc-guanyin-100');
const RANKS = Object.freeze({
  upper: { vi: 'Thượng', label: 'Quẻ thượng' },
  middle: { vi: 'Trung', label: 'Quẻ trung' },
  lower: { vi: 'Hạ', label: 'Quẻ hạ' },
});
const TRANSLATION_STATUS = Object.freeze({ reviewed_with_traditional_poetry: 'Bản dịch thơ đã được duyệt', ai_draft_unreviewed: 'Bản dịch sơ bộ, chưa được duyệt' });
const SOURCE_URL = /^https:\/\/www\.ctc\.org\.hk\/chim\/[^\s]+$/;
const MAX_PEOPLE = 1000, RECENT_PER_PERSON = 10, MAX_FILE_BYTES = 1024 * 1024;
const REUSE_BASIS = 'Quyền tái phân phối CHƯA được xác nhận: chỉ lưu bài thơ truyền thống và lời giải ngắn kèm nguồn; không sao chép phần bình giải hiện đại của trang.';

function readJson(file) {
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > MAX_FILE_BYTES) throw new Error('fortune_file_invalid');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function lines(value, code) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(l => typeof l !== 'string' || !l.trim())) throw new Error(code);
  return value;
}

// Rejects partial, duplicated or unsourced data; never fills a gap with generated text.
function loadEdition(dir = DEFAULT_DIR) {
  const source = readJson(path.join(dir, 'source.json'));
  const vi = readJson(path.join(dir, 'vi.json'));
  if (!TRANSLATION_STATUS[vi.status]) throw new Error('fortune_translation_status_invalid');
  if (source.collectionId !== vi.collectionId || !source.collectionId) throw new Error('fortune_collection_mismatch');
  if (!Array.isArray(source.records) || source.records.length !== source.recordCount || source.recordCount < 1) throw new Error('fortune_count_mismatch');
  if (!Array.isArray(vi.records) || vi.records.length !== source.records.length) throw new Error('fortune_translation_incomplete');
  const counts = { upper: 0, middle: 0, lower: 0 }, seen = new Set(), records = [];
  source.records.forEach((r, i) => {
    const t = vi.records[i];
    if (!Number.isSafeInteger(r.number) || r.number !== i + 1 || seen.has(r.number)) throw new Error('fortune_number_invalid');
    seen.add(r.number);
    if (!RANKS[r.rank]) throw new Error(`fortune_rank_invalid:${r.number}`);
    counts[r.rank]++;
    if (typeof r.storyTitleOriginal !== 'string' || !r.storyTitleOriginal || typeof r.rankOriginal !== 'string') throw new Error(`fortune_title_missing:${r.number}`);
    if (typeof r.sourceUrl !== 'string' || !SOURCE_URL.test(r.sourceUrl) || !/^\d{4}-\d{2}-\d{2}$/.test(r.accessedAt || '')) throw new Error(`fortune_source_missing:${r.number}`);
    if (r.verification !== 'captured_from_publisher_page') throw new Error(`fortune_unverified:${r.number}`);
    if (!t || t.number !== r.number || typeof t.storyTitleVi !== 'string' || !t.storyTitleVi || typeof t.glossVi !== 'string' || !t.glossVi) throw new Error(`fortune_translation_missing:${r.number}`);
    const poemVi = lines(t.poemVi, `fortune_poem_vi_invalid:${r.number}`), poemHanViet = lines(t.poemHanViet, `fortune_poem_hanviet_invalid:${r.number}`);
    records.push(Object.freeze({
      id: `${source.collectionId}:${source.edition}:${r.number}`, collectionId: source.collectionId, editionId: source.edition, number: r.number,
      rankTier: r.rank,
      original: { language: r.originalLanguage, title: r.storyTitleOriginal, poem: lines(r.originalPoem, `fortune_poem_invalid:${r.number}`).join('\n'),
        gloss: lines(r.originalGloss, `fortune_gloss_invalid:${r.number}`).join('\n'), rank: r.rankOriginal },
      source: { publisher: source.publisher, edition: source.edition, url: r.sourceUrl, accessedAt: r.accessedAt, verification: 'verified', reuseBasis: REUSE_BASIS },
      vietnamese: { title: t.storyTitleVi, rank: RANKS[r.rank].vi, poemTranslation: poemVi.join('\n'), poemHanViet: poemHanViet.join('\n'),
        summary: t.glossVi, translator: vi.translator ?? null, kind: 'translation', reviewStatus: vi.status,
        reviewLabel: TRANSLATION_STATUS[vi.status], uncertain: t.uncertain === true },
      // Speech reads the Vietnamese verse; the longer gloss stays on screen/data only (320-scalar TTS limit).
      ttsSummary: `Quẻ số ${r.number}, ${RANKS[r.rank].label.toLowerCase()}. Tích ${t.storyTitleVi}.\nThơ. ${poemVi.join(' ')}`,
    }));
  });
  for (const k of Object.keys(counts)) if (source.rankCounts?.[k] !== counts[k]) throw new Error('fortune_rank_counts_mismatch');
  return Object.freeze({ collectionId: source.collectionId, edition: source.edition, publisher: source.publisher, sourceIndex: source.sourceIndex,
    reuseNote: source.reuseNote, rankCounts: Object.freeze(counts), records: Object.freeze(records) });
}

// Sampling policy of this app (not a temple ritual): draw without replacement from a shuffled
// cycle; per-person recent history is skipped while another card remains. Fully independent of
// coins, gifts, merit or seat priority.
class FortuneDeck {
  constructor(edition, { rng = Math.random, recentPerPerson = RECENT_PER_PERSON, maxPeople = MAX_PEOPLE } = {}) {
    if (!edition?.records?.length) throw new TypeError('fortune_edition_required');
    this.edition = edition; this.rng = rng; this.recentPerPerson = recentPerPerson; this.maxPeople = maxPeople;
    this.cycle = 0; this.last = null; this.remaining = []; this.history = new Map();
    this.reshuffle();
  }
  random(n) {
    const v = Math.floor(this.rng() * n);
    return Number.isFinite(v) && v >= 0 && v < n ? v : 0;
  }
  reshuffle() {
    const numbers = this.edition.records.map(r => r.number);
    for (let i = numbers.length - 1; i > 0; i--) { const j = this.random(i + 1); [numbers[i], numbers[j]] = [numbers[j], numbers[i]]; }
    // The next card (end of array) must not repeat the card that closed the previous cycle.
    const end = numbers.length - 1;
    if (numbers.length > 1 && numbers[end] === this.last) [numbers[end], numbers[0]] = [numbers[0], numbers[end]];
    this.remaining = numbers; this.cycle++;
  }
  draw(personKey) {
    if (!this.remaining.length) this.reshuffle();
    const key = typeof personKey === 'string' && personKey ? personKey : null;
    const recent = key ? this.history.get(key) || [] : [];
    let index = this.remaining.length - 1;
    for (let i = this.remaining.length - 1; i >= 0; i--) if (!recent.includes(this.remaining[i])) { index = i; break; }
    const [number] = this.remaining.splice(index, 1);
    this.last = number;
    if (key) {
      this.history.delete(key); // Map order doubles as least-recently-used order.
      this.history.set(key, [...recent, number].slice(-this.recentPerPerson));
      while (this.history.size > this.maxPeople) this.history.delete(this.history.keys().next().value);
    }
    return this.edition.records[number - 1];
  }
  reset() { this.last = null; this.history.clear(); this.cycle = 0; this.reshuffle(); }
  serialize() {
    return { collectionId: this.edition.collectionId, cycle: this.cycle, last: this.last, remaining: [...this.remaining],
      history: [...this.history].map(([key, numbers]) => [key, numbers]) };
  }
  // Untrusted saved data: anything inconsistent falls back to the fresh shuffle made by the constructor.
  restore(saved) {
    try {
      const total = this.edition.records.length;
      if (!saved || saved.collectionId !== this.edition.collectionId || !Array.isArray(saved.remaining) || saved.remaining.length > total) return false;
      const unique = new Set(saved.remaining);
      if (unique.size !== saved.remaining.length || saved.remaining.some(n => !Number.isSafeInteger(n) || n < 1 || n > total)) return false;
      const history = new Map();
      for (const entry of (Array.isArray(saved.history) ? saved.history : []).slice(-this.maxPeople)) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[0] || entry[0].length > 80 || !Array.isArray(entry[1])) continue;
        const numbers = entry[1].filter(n => Number.isSafeInteger(n) && n >= 1 && n <= total).slice(-this.recentPerPerson);
        history.set(entry[0], numbers);
      }
      this.remaining = saved.remaining.slice();
      this.history = history;
      this.last = Number.isSafeInteger(saved.last) && saved.last >= 1 && saved.last <= total ? saved.last : null;
      this.cycle = Number.isSafeInteger(saved.cycle) && saved.cycle >= 1 ? saved.cycle : 1;
      return true;
    } catch { return false; }
  }
}

module.exports = { TRANSLATION_STATUS, loadEdition, FortuneDeck, RANKS, REUSE_BASIS, DEFAULT_DIR };
