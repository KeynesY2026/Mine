const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.existsSync('js/audio-feedback.js')
  ? fs.readFileSync('js/audio-feedback.js', 'utf8') : '';
const html = fs.readFileSync('index.html', 'utf8');
const ui = fs.readFileSync('js/ui.js', 'utf8');
const css = fs.readFileSync('css/style.css', 'utf8');

function fixture({ stored = null, audioAvailable = true, mediaAvailable = true } = {}) {
  const values = new Map(stored === null ? [] : [['minestorm.sound.enabled', stored]]);
  const frequencies = [];
  const filters = [];
  const buffers = [];
  const gainPeaks = [];
  const oscillatorDurations = [];
  let bufferSourceCount = 0;
  const media = [];
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
  };
  class AudioContext {
    constructor() { this.currentTime = 0; this.destination = {}; this.sampleRate = 8000; }
    createOscillator() {
      const frequency = {
        value: 0,
        setValueAtTime(value) { this.value = value; frequencies.push({ value, ramp: false }); },
        exponentialRampToValueAtTime(value) { this.value = value; frequencies.push({ value, ramp: true }); },
      };
      let startedAt = 0;
      return {
        frequency, connect() {},
        start(time = 0) { startedAt = time; },
        stop(time = startedAt) { oscillatorDurations.push(time - startedAt); },
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime(value) { if (value > 0.0001) gainPeaks.push(value); },
        },
        connect() {},
      };
    }
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      buffers.push({ channels, length, sampleRate, data });
      return { getChannelData: () => data };
    }
    createBufferSource() {
      bufferSourceCount++;
      return { connect() {}, start() {}, stop() {} };
    }
    createBiquadFilter() {
      const filter = {
        type: '', frequency: {
          setValueAtTime(value) { this.value = value; },
          exponentialRampToValueAtTime(value) { this.endValue = value; },
        },
        connect() {},
      };
      filters.push(filter);
      return filter;
    }
  }
  class Audio {
    constructor(src) {
      this.src = src;
      this.duration = src.endsWith('mine-hit.mp3') ? 1.42729 : 3.19;
      this.currentTime = 0;
      this.volume = 1;
      this.playbackRate = 1;
      this.paused = true;
      media.push(this);
    }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    addEventListener() {}
  }
  const window = {
    ...(audioAvailable ? { AudioContext } : {}),
    ...(mediaAvailable ? { Audio } : {}),
  };
  const context = { window, localStorage: storage };
  vm.runInNewContext(source, context);
  const create = context.window.MineAudioFeedback?.create;
  assert.equal(typeof create, 'function', 'audio feedback module is available');
  return { audio: create({ window, storage }), create: () => create({ window, storage }), values, frequencies, filters, buffers, gainPeaks, oscillatorDurations, media,
    get bufferSourceCount() { return bufferSourceCount; } };
}

test('common actions, mine hits, and bomb detonation use audibly separate sounds', () => {
  const effects = ['click', 'open', 'mine', 'bomb', 'victory'];
  const signatures = effects.map(effect => {
    const state = fixture();
    assert.equal(state.audio.play(effect), true);
    return JSON.stringify({
      tones: state.frequencies.map(note => `${note.value}${note.ramp ? 'r' : ''}`),
      tracks: state.media.map(sound => sound.src),
    });
  });

  assert.equal(new Set(signatures).size, effects.length);
});

test('bomb attack button uses the normal click sound and reserves the explosion for detonation', () => {
  const bombButton = ui.match(/\$\('btnBomb'\)\.addEventListener\('click', \(\) => \{([\s\S]*?)\n  \}\);/)?.[1] || '';

  assert.match(bombButton, /audioFeedback\.play\('click'\)/);
  assert.doesNotMatch(bombButton, /audioFeedback\.play\('bomb(?:Mode)?'\)/);
});

test('mine-hit volume uses the requested much quieter level than the deliberate bomb release', () => {
  const mine = fixture();
  const bomb = fixture();
  mine.audio.play('mine');
  bomb.audio.play('bomb');

  assert.match(mine.media[0]?.src || '', /assets\/audio\/mine-hit\.mp3$/);
  assert.ok(mine.media[0].playbackRate >= 1.5, 'the selected clip stays short');
  assert.ok(mine.media[0].volume <= 0.1, 'the mine hit uses the requested much quieter level');
  assert.ok(mine.media[0].volume < bomb.media[0].volume, 'the mine hit is quieter than bomb release');
  assert.equal(mine.buffers.length, 0, 'the mine effect does not add the bomb attack rumble');
});

test('detonation plays a longer explosion recording and layers a filtered low rumble', () => {
  const fixtureState = fixture();
  fixtureState.audio.play('bomb');

  assert.match(fixtureState.media[0]?.src || '', /assets\/audio\/bomb-explosion\.mp3$/);
  assert.ok(fixtureState.media[0].duration >= 3, 'the explosion recording gives the blast a longer, cinematic tail');
  assert.equal(fixtureState.bufferSourceCount, 1, 'the blast adds an impact-noise layer');
  assert.equal(fixtureState.filters[0]?.type, 'lowpass', 'the additional noise is filtered into a rumble');
  assert.ok(fixtureState.frequencies.some(note => note.value <= 100), 'the blast includes deep bass');
});

test('detonation retains a synthesized rumble fallback when media playback is unavailable', () => {
  const fixtureState = fixture({ mediaAvailable: false });
  fixtureState.audio.play('bomb');

  assert.equal(fixtureState.bufferSourceCount, 1);
  assert.ok(fixtureState.frequencies.some(note => note.value <= 100));
});

test('muting stops a currently playing explosion asset immediately', () => {
  const { audio, media } = fixture();
  audio.play('bomb');
  assert.equal(media[0].paused, false);
  audio.setEnabled(false);
  assert.equal(media[0].paused, true);
});

test('muting prevents playback and the preference survives creation of another audio controller', () => {
  const first = fixture();
  assert.equal(first.audio.isEnabled(), true, 'sound is enabled by default');
  assert.equal(first.audio.setEnabled(false), false);
  assert.equal(first.values.get('minestorm.sound.enabled'), 'false');
  assert.equal(first.audio.play('click'), false);
  assert.deepEqual(first.frequencies, []);

  const restored = first.create();
  assert.equal(restored.isEnabled(), false);
  assert.equal(restored.play('victory'), false);
  assert.deepEqual(first.frequencies, []);
  restored.setEnabled(true);
  assert.equal(first.values.get('minestorm.sound.enabled'), 'true');
});

test('audio feedback remains safe when browser audio is unavailable', () => {
  const { audio } = fixture({ audioAvailable: false, mediaAvailable: false });
  assert.equal(audio.play('bomb'), false);
});

test('global sound control is accessible and game actions are connected to distinct effects', () => {
  assert.match(html, /<button[^>]*id="btnSound"[^>]*aria-pressed="true"/);
  assert.match(html, /<script src="js\/audio-feedback\.js"><\/script>/);
  assert.match(ui, /MineAudioFeedback\.create/);
  assert.match(ui, /btnSound'[\s\S]{0,180}audioFeedback\.toggle\(\)/);
  assert.match(ui, /audioFeedback\.play\('open'\)/);
  assert.match(ui, /audioFeedback\.play\('bomb'\)/);
  assert.doesNotMatch(ui, /audioFeedback\.play\('bombMode'\)/);
  const afterMove = ui.match(/function afterMove\(r, extraDelay\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const onGameOver = ui.match(/function onGameOver\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(afterMove, /r\.kind === 'bomb'[\s\S]{0,70}audioFeedback\.play\('bomb'\)[\s\S]{0,100}r\.kind === 'mine'[\s\S]{0,70}audioFeedback\.play\('mine'\)[\s\S]{0,80}audioFeedback\.play\('open'\)/);
  assert.match(onGameOver, /game\.winner !== 'draw'\) audioFeedback\.play\('victory'\)/);
  assert.match(ui, /addEventListener\('change',[\s\S]{0,150}audioFeedback\.play\('click'\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?#btnSound \.sound-label \{ display: none; \}/);
  assert.match(css, /\.cell\.blast\s*\{[^}]*animation:\s*blast\s+1\.45s/);
  assert.match(ui, /setTimeout\(el => el\.classList\.remove\('blast'\),\s*1500/);
});
