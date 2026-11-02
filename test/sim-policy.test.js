const { test } = require('node:test');
const assert = require('node:assert/strict');
const { npcTarget, npcIntervalMs, shouldSkipStep, MAX_NPC } = require('../lib/sim-policy');

test('NPC crew shrinks monotonically as real viewers grow and refills when they leave', () => {
  const counts = [0, 3, 5, 9, 10, 14, 15, 19, 20, 29, 30, 49, 50, 99, 100, 5000].map(npcTarget);
  assert.deepEqual(counts, [18, 18, 14, 14, 10, 10, 8, 8, 5, 5, 3, 3, 2, 2, 1, 1]);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i] <= counts[i - 1]);
  assert.equal(npcTarget(0), MAX_NPC);
  assert.equal(npcTarget(NaN), MAX_NPC);
  assert.equal(npcTarget(-4), MAX_NPC);
});

test('fewer NPCs act less often, capped at 4x the base interval', () => {
  assert.equal(npcIntervalMs(9500, 18), 9500);
  assert.ok(npcIntervalMs(9500, 5) > 9500);
  assert.equal(npcIntervalMs(9500, 1), 9500 * 4);
});

test('a small crew only fills silence; a large crew keeps going', () => {
  const now = 100000;
  assert.equal(shouldSkipStep({ target: 3, lastRealAt: now - 5000, now }), true);
  assert.equal(shouldSkipStep({ target: 3, lastRealAt: now - 20000, now }), false);
  assert.equal(shouldSkipStep({ target: 3, lastRealAt: 0, now }), false);
  assert.equal(shouldSkipStep({ target: 14, lastRealAt: now - 1000, now }), false);
});
