// Shared by Node and the overlay so gift thresholds cannot drift between queues.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TempleQueues = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const TIERS = ['community', 'lotus', 'lamp', 'fruit', 'dragon'];
  function eventTier(event) {
    if (!['offerGift', 'grandCeremony'].includes(event?.type)) return 'community';
    const coins = Number(event.coins) || 0;
    return coins >= 100 ? 'dragon' : coins >= 20 ? 'fruit' : coins >= 5 ? 'lamp' : 'lotus';
  }

  class LaneQueue {
    constructor(limits = {}) {
      this.lanes = Object.fromEntries(TIERS.map(tier => [tier, []]));
      this.limits = Object.fromEntries(TIERS.map(tier => [tier, limits[tier] ?? 4]));
    }
    get length() { return TIERS.reduce((sum, tier) => sum + this.lanes[tier].length, 0); }
    counts() { return Object.fromEntries(TIERS.map(tier => [tier, this.lanes[tier].length])); }
    push(item, front = false) {
      const lane = this.lanes[item.tier];
      if (!lane || lane.length >= this.limits[item.tier]) return false;
      if (front) lane.unshift(item); else lane.push(item);
      return true;
    }
    shift() {
      for (const tier of [...TIERS].reverse()) if (this.lanes[tier].length) return this.lanes[tier].shift();
      return null;
    }
    remove(predicate) {
      const removed = [];
      for (const tier of TIERS) this.lanes[tier] = this.lanes[tier].filter(item => {
        if (!predicate(item)) return true;
        removed.push(item); return false;
      });
      return removed;
    }
  }

  // Only one foreground ritual/speech at a time. A higher tier interrupts it;
  // interrupted gifts resume from the start, interrupted community events retire.
  class RitualScheduler {
    constructor({ onStart, onStop, onAudio, onDrop = () => {}, now = Date.now,
      setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id),
      holdMs = 8000, maxHoldMs = 45000 } = {}) {
      Object.assign(this, { onStart, onStop, onAudio, onDrop, now, setTimer, clearTimer, holdMs, maxHoldMs });
      this.queue = new LaneQueue({ community: 10, lotus: 20, lamp: 20, fruit: 20, dragon: 20 });
      this.items = new Map();
      this.active = null;
    }
    prune() {
      for (const item of this.queue.remove(item => item.expiresAt <= this.now())) this.drop(item, 'expired');
    }
    drop(item, reason) { this.items.delete(item.event.id); this.onDrop(item.event, reason); }
    enqueue(event) {
      if (!event?.id || this.items.has(event.id)) return false;
      this.prune();
      const tier = eventTier(event);
      const item = { event, tier, pending: Boolean(event.ttsPending), url: event.ttsUrl || null,
        expiresAt: this.now() + (tier === 'community' ? 15000 : 120000) };
      // Reserve space for an active gift so preemption can always put it back.
      if (tier !== 'community' && this.active?.item.tier === tier &&
          this.queue.lanes[tier].length >= this.queue.limits[tier] - 1) {
        this.onDrop(event, 'full'); return false;
      }
      if (!this.queue.push(item)) { this.onDrop(event, 'full'); return false; }
      this.items.set(event.id, item);
      if (this.active && TIERS.indexOf(tier) > TIERS.indexOf(this.active.item.tier)) {
        const previous = this.active.item;
        this.stopActive();
        if (previous.tier !== 'community' && !this.queue.push(previous, true)) this.drop(previous, 'full');
        else if (previous.tier === 'community') this.drop(previous, 'interrupted');
      }
      this.pump();
      return true;
    }
    audioReady({ eventId, url }) {
      const item = this.items.get(eventId);
      if (!item) return; // Late audio for dropped/expired/interrupted comments stays silent.
      item.pending = false;
      item.url = typeof url === 'string' && /^\/tts-cache\/[a-z0-9_-]+\.wav$/.test(url) ? url : null;
      if (this.active?.item === item) { this.playAudio(); this.schedule(); }
    }
    pump() {
      if (this.active) return;
      this.prune();
      const item = this.queue.shift();
      if (!item) return;
      this.active = { item, startedAt: this.now(), audioStarted: false, speaking: false, timer: null };
      this.onStart?.(item.event);
      this.playAudio();
      this.schedule();
    }
    playAudio() {
      const active = this.active;
      if (!active || active.audioStarted || !active.item.url) return;
      active.audioStarted = true; active.speaking = true;
      this.onAudio?.(active.item.event, active.item.url, () => {
        if (this.active !== active) return;
        active.speaking = false; this.schedule();
      });
    }
    schedule() {
      const active = this.active;
      if (!active) return;
      this.clearTimer(active.timer);
      const duration = active.item.pending || active.speaking ? this.maxHoldMs : this.holdMs;
      active.timer = this.setTimer(() => {
        if (this.active !== active) return;
        this.stopActive(); this.items.delete(active.item.event.id); this.pump();
      }, Math.max(0, active.startedAt + duration - this.now()));
    }
    stopActive() {
      if (!this.active) return;
      const active = this.active; this.active = null;
      this.clearTimer(active.timer); this.onStop?.(active.item.event);
    }
    stop() { this.stopActive(); this.queue.remove(() => true); this.items.clear(); }
  }
  return { TIERS, eventTier, LaneQueue, RitualScheduler };
});
