'use strict';
// How many simulated worshippers (NPC) to keep around, given the real viewer count.
// The fewer real people are watching, the more NPCs fill the hall; a big room keeps only
// a few that step in when nobody real is interacting.
const NPC_STEPS = Object.freeze([
  [0, 18], [5, 14], [10, 10], [15, 8], [20, 5], [30, 3], [50, 2], [100, 1],
]);
const MAX_NPC = NPC_STEPS[0][1];
const QUIET_AFTER_REAL_MS = 15000;

function npcTarget(viewers) {
  const v = Number.isFinite(viewers) && viewers > 0 ? viewers : 0;
  let target = MAX_NPC;
  for (const [from, count] of NPC_STEPS) if (v >= from) target = count;
  return target;
}

// Fewer NPCs also act less often, so the room does not feel scripted. Capped at 4x the base interval.
function npcIntervalMs(baseMs, target) {
  return Math.round(baseMs * Math.min(4, Math.max(1, Math.sqrt(MAX_NPC / Math.max(1, target)))));
}

// With a small NPC crew the simulation only fills silence: skip a step while real viewers are active.
function shouldSkipStep({ target, lastRealAt, now }) {
  return target <= 5 && lastRealAt > 0 && now - lastRealAt < QUIET_AFTER_REAL_MS;
}

module.exports = { NPC_STEPS, MAX_NPC, QUIET_AFTER_REAL_MS, npcTarget, npcIntervalMs, shouldSkipStep };
