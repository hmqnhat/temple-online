const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('preempting speech stops old playback; late completion cannot clear or finish new donor playback', async () => {
  const players = [], ended = [];
  class Audio {
    constructor(url) { this.url = url; this.paused = true; players.push(this); }
    play() { this.paused = false; return new Promise((_resolve, reject) => { this.reject = reject; }); }
    pause() { this.paused = true; }
  }
  const context = { window: {}, Audio, localStorage: { getItem: () => null }, setTimeout, clearTimeout, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/audio.js'), 'utf8'), context);
  const engine = new context.window.TempleAudioEngine();
  engine.enqueueTts('Bình luận', { url: '/tts-cache/comment.wav', onEnd: () => ended.push('comment') });
  const previous = players[1];
  engine.cancelTts();
  assert.equal(previous.paused, true);
  engine.enqueueTts('Cảm ơn người tặng quà', { url: '/tts-cache/gift.wav', onEnd: () => ended.push('gift') });
  const donor = players[2];
  previous.reject(new Error('Old audio cancelled'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.currentAudio, donor);
  assert.equal(engine.ttsPlaying, true);
  assert.deepEqual(ended, []);
  donor.onended();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(ended, ['gift']);
  assert.equal(engine.currentAudio, null);
  assert.equal(engine.ttsPlaying, false);
});
