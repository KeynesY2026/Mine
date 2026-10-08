"use strict";
(() => {
  const STORAGE_KEY = 'minestorm.sound.enabled';
  const assetPaths = {
    bomb: 'assets/audio/bomb-explosion.mp3',
    mine: 'assets/audio/mine-hit.mp3',
  };
  const tones = {
    click: [{ frequency: 680, duration: 0.055 }],
    open: [{ frequency: 390, duration: 0.055 }, { frequency: 560, duration: 0.075, delay: 0.04 }],
    mine: [{ frequency: 185, duration: 0.1 }, { frequency: 118, duration: 0.14, delay: 0.045 }],
    victory: [
      { frequency: 523, duration: 0.12 }, { frequency: 659, duration: 0.12, delay: 0.11 },
      { frequency: 784, duration: 0.12, delay: 0.22 }, { frequency: 1047, duration: 0.32, delay: 0.33 },
    ],
  };

  function playBombRumble(context, now) {
    const duration = 1.4;
    const sampleRate = context.sampleRate || 44100;
    const length = Math.floor(sampleRate * duration);
    const buffer = context.createBuffer(1, length, sampleRate);
    const samples = buffer.getChannelData(0);
    let seed = 0x6d2b79f5;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 0x100000000 * 2 - 1;
      const decay = Math.pow(1 - i / length, 0.65);
      samples[i] = noise * decay;
    }

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(68, now + duration);
    const impact = context.createBufferSource();
    impact.buffer = buffer;
    const impactGain = context.createGain();
    impactGain.gain.setValueAtTime(0.0001, now);
    impactGain.gain.exponentialRampToValueAtTime(0.24, now + 0.025);
    impactGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    impact.connect(filter);
    filter.connect(impactGain);
    impactGain.connect(context.destination);
    impact.start(now);
    impact.stop(now + duration);

    const bass = context.createOscillator();
    const bassGain = context.createGain();
    bass.type = 'triangle';
    bass.frequency.setValueAtTime(92, now);
    bass.frequency.exponentialRampToValueAtTime(34, now + 1.15);
    bassGain.gain.setValueAtTime(0.0001, now);
    bassGain.gain.exponentialRampToValueAtTime(0.19, now + 0.018);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
    bass.connect(bassGain);
    bassGain.connect(context.destination);
    bass.start(now);
    bass.stop(now + 1.3);
    return true;
  }

  function create({ window: hostWindow = window, storage } = {}) {
    let enabled = true;
    let context = null;
    const mediaSounds = {};
    try {
      const saved = (storage || hostWindow.localStorage)?.getItem(STORAGE_KEY);
      if (saved === 'false') enabled = false;
    } catch (_) {}

    function ensureContext() {
      const AudioContext = hostWindow.AudioContext || hostWindow.webkitAudioContext;
      if (!AudioContext) return null;
      if (!context) context = new AudioContext();
      if (context.state === 'suspended' && typeof context.resume === 'function') Promise.resolve(context.resume()).catch(() => {});
      return context;
    }

    function playTone(effect, notes) {
      try {
        const audioContext = ensureContext();
        if (!audioContext) return false;
        const now = audioContext.currentTime;
        for (const note of notes) {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const startAt = now + (note.delay || 0);
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(note.startFrequency || note.frequency, startAt);
          if (note.startFrequency) oscillator.frequency.exponentialRampToValueAtTime(note.frequency, startAt + note.duration);
          gain.gain.setValueAtTime(0.0001, startAt);
          const peak = effect === 'mine' ? 0.032 : effect === 'click' ? 0.045 : 0.075;
          gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.0001, startAt + note.duration);
          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start(startAt);
          oscillator.stop(startAt + note.duration + 0.015);
        }
        return true;
      } catch (_) {
        return false;
      }
    }

    function playAsset(effect) {
      const Audio = hostWindow.Audio;
      if (typeof Audio !== 'function') return false;
      try {
        let sound = mediaSounds[effect];
        if (!sound) {
          sound = mediaSounds[effect] = new Audio(assetPaths[effect]);
          sound.preload = 'auto';
        }
        sound.pause();
        sound.currentTime = 0;
        sound.volume = effect === 'bomb' ? 0.86 : effect === 'mine' ? 0.1 : 0.7;
        sound.playbackRate = effect === 'mine' ? 1.55 : 1;
        const playback = sound.play();
        if (playback?.catch) playback.catch(() => {
          if (enabled && effect === 'mine') playTone('mine', tones.mine);
        });
        return true;
      } catch (_) {
        return false;
      }
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) {
        for (const sound of Object.values(mediaSounds)) {
          try { sound.pause(); sound.currentTime = 0; } catch (_) {}
        }
        try { context?.suspend?.()?.catch?.(() => {}); } catch (_) {}
      }
      try { (storage || hostWindow.localStorage)?.setItem(STORAGE_KEY, String(enabled)); } catch (_) {}
      return enabled;
    }

    function toggle() {
      return setEnabled(!enabled);
    }

    function play(effect) {
      if (!enabled) return false;
      if (assetPaths[effect]) {
        const assetPlayed = playAsset(effect);
        if (effect === 'bomb') {
          if (assetPlayed) {
            try {
              const audioContext = ensureContext();
              if (audioContext) playBombRumble(audioContext, audioContext.currentTime);
            } catch (_) {}
            return true;
          }
          try {
            const audioContext = ensureContext();
            return audioContext ? playBombRumble(audioContext, audioContext.currentTime) : false;
          } catch (_) { return false; }
        }
        if (assetPlayed) return true;
        if (effect === 'mine') return playTone('mine', tones.mine);
        return false;
      }
      const notes = tones[effect];
      return notes ? playTone(effect, notes) : false;
    }

    return { isEnabled: () => enabled, setEnabled, toggle, play };
  }

  window.MineAudioFeedback = { create };
})();
