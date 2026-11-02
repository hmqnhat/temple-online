const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TIERS, eventTier, RitualScheduler } = require('../public/js/ritual-queue');

function fixture(options = {}) {
  let now = 0, seq = 0;
  const timers = new Map(), starts = [], stops = [], drops = [], speech = [];
  const scheduler = new RitualScheduler({
    now: () => now,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: id => timers.delete(id),
    onStart: ev => starts.push(ev.id), onStop: ev => stops.push(ev.id),
    onDrop: (ev, reason) => drops.push([ev.id, reason]),
    onAudio: (ev, url, done) => speech.push({ id: ev.id, url, done }), ...options
  });
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].fn();
    }
    now = end;
  }
  return { scheduler, starts, stops, drops, speech, advance, timers };
}
const comment = id => ({ id, type: 'sendPrayer', ttsText: 'Cầu bình an' });
const gift = (id, coins) => ({ id, type: 'offerGift', coins, ttsText: 'Cảm ơn đã ủng hộ' });

test('gift tier boundaries use value rather than viewer-provided names', () => {
  assert.deepEqual([1, 4, 5, 19, 20, 99, 100, 10000].map(coins => eventTier(gift('g', coins))),
    ['lotus', 'lotus', 'lamp', 'lamp', 'fruit', 'fruit', 'dragon', 'dragon']);
  assert.equal(eventTier({ ...comment('c'), coins: 99999, priorityTier: 'dragon' }), 'community');
});

test('comment floods cannot overwrite donor; higher gifts preempt, equal gifts keep FIFO and interrupted gifts resume', () => {
  const f = fixture();
  f.scheduler.enqueue(comment('comment-active'));
  for (let i = 0; i < 30; i++) f.scheduler.enqueue(comment(`comment-${i}`));
  assert.equal(f.scheduler.queue.counts().community, 10);
  f.scheduler.enqueue(gift('small-first', 1));
  assert.equal(f.scheduler.active.item.event.id, 'small-first');
  f.scheduler.enqueue(gift('small-second', 1));
  f.scheduler.enqueue(gift('medium', 10));
  f.scheduler.enqueue(gift('large-first', 100));
  f.scheduler.enqueue(gift('large-second', 100));
  for (let i = 30; i < 60; i++) f.scheduler.enqueue(comment(`comment-${i}`));
  assert.equal(f.scheduler.active.item.event.id, 'large-first');
  f.advance(8000); assert.equal(f.scheduler.active.item.event.id, 'large-second');
  f.advance(8000); assert.equal(f.scheduler.active.item.event.id, 'medium');
  f.advance(8000); assert.equal(f.scheduler.active.item.event.id, 'small-first');
  f.advance(8000); assert.equal(f.scheduler.active.item.event.id, 'small-second');
  f.advance(8000); assert.equal(f.scheduler.active, null); // Old comments expired.
  assert.ok(f.drops.some(([id, reason]) => id === 'comment-active' && reason === 'interrupted'));
  f.scheduler.stop(); assert.equal(f.timers.size, 0);
});

test('visual starts before audio; late comment audio stays silent and stale callbacks cannot finish a donor', () => {
  const f = fixture();
  f.scheduler.enqueue({ ...comment('c'), ttsPending: true });
  assert.deepEqual(f.starts, ['c']); assert.equal(f.speech.length, 0);
  f.scheduler.audioReady({ eventId: 'c', url: '/tts-cache/c.wav' });
  assert.equal(f.speech[0].id, 'c');
  f.scheduler.enqueue({ ...gift('g', 100), ttsPending: true });
  f.scheduler.audioReady({ eventId: 'c', url: '/tts-cache/c.wav' });
  f.speech[0].done();
  f.advance(9000); assert.equal(f.scheduler.active.item.event.id, 'g');
  f.scheduler.audioReady({ eventId: 'g', url: '/tts-cache/g.wav' });
  assert.equal(f.speech.length, 2); assert.equal(f.speech[1].id, 'g');
  f.speech[1].done(); f.advance(0); assert.equal(f.scheduler.active, null);
});

test('failed/missing audio cannot stall presentation; higher tiers have separate bounded capacity', () => {
  const f = fixture();
  f.scheduler.enqueue({ ...gift('active', 100), ttsPending: true });
  for (let i = 0; i < 30; i++) f.scheduler.enqueue(gift(`big-${i}`, 100));
  for (const [i, coins] of [1, 5, 20].entries()) assert.ok(f.scheduler.enqueue(gift(`other-${i}`, coins)));
  assert.equal(f.scheduler.queue.counts().dragon, 19);
  assert.ok(f.drops.some(([, reason]) => reason === 'full'));
  f.advance(45000); assert.equal(f.scheduler.active.item.event.id, 'big-0');
  f.scheduler.stop(); assert.equal(f.scheduler.items.size, 0);
  assert.equal(f.scheduler.queue.length, 0); assert.equal(f.timers.size, 0);

  const failed = fixture();
  failed.scheduler.enqueue({ ...gift('failed', 100), ttsPending: true });
  failed.scheduler.audioReady({ eventId: 'failed', url: null });
  failed.advance(8000); assert.equal(failed.scheduler.active, null);
  assert.deepEqual(failed.speech, []);
  assert.equal(TIERS.length, 5);
});

test('interrupting a full gift tier preserves its active donor at the front of that tier', () => {
  const f = fixture();
  f.scheduler.enqueue(gift('first-small', 1));
  for (let i = 0; i < 19; i++) assert.ok(f.scheduler.enqueue(gift(`small-${i}`, 1)));
  assert.equal(f.scheduler.enqueue(gift('small-overflow', 1)), false);
  f.scheduler.enqueue(gift('big', 100));
  assert.equal(f.scheduler.queue.counts().lotus, 20);
  f.advance(8000);
  assert.equal(f.scheduler.active.item.event.id, 'first-small');
  f.scheduler.stop();
});

test('with startWaitMs, visuals wait for the voice, start when audio settles, and never wait past the bound', () => {
  const f = fixture({ startWaitMs: 20000 });
  f.scheduler.enqueue({ ...gift('g1', 20), ttsPending: true });
  assert.deepEqual(f.starts, [], 'no visuals while synthesis is pending');
  f.advance(9000);
  f.scheduler.audioReady({ eventId: 'g1', url: '/tts-cache/maichi_a.wav' });
  assert.deepEqual(f.starts, ['g1']);
  assert.equal(f.speech.length, 1, 'voice starts together with visuals');

  const failed = fixture({ startWaitMs: 20000 });
  failed.scheduler.enqueue({ ...gift('g2', 20), ttsPending: true });
  failed.scheduler.audioReady({ eventId: 'g2', url: null });
  assert.deepEqual(failed.starts, ['g2'], 'failed synthesis still shows the ritual');
  failed.advance(7000);
  assert.deepEqual(failed.stops, [], 'hold time counts from when visuals started');

  const slow = fixture({ startWaitMs: 20000 });
  slow.scheduler.enqueue({ ...gift('g3', 20), ttsPending: true });
  slow.advance(19999); assert.deepEqual(slow.starts, []);
  slow.advance(2); assert.deepEqual(slow.starts, ['g3']);

  const ready = fixture({ startWaitMs: 20000 });
  ready.scheduler.enqueue({ ...gift('g4', 20), ttsPending: false });
  assert.deepEqual(ready.starts, ['g4'], 'events without a pending voice start at once');
});
