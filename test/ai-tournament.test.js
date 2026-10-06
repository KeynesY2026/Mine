const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeededCrypto, createRuntime } = require('../scripts/ai-tournament-runtime');

test('seeded crypto fills deterministic words and continues its sequence', () => {
  const first = createSeededCrypto(12345);
  const second = createSeededCrypto(12345);
  const firstWords = new Uint32Array(8);
  const secondWords = new Uint32Array(8);

  assert.equal(first.getRandomValues(firstWords), firstWords);
  second.getRandomValues(secondWords);
  assert.deepEqual(firstWords, secondWords);

  const nextWords = new Uint32Array(8);
  const restartedWords = new Uint32Array(8);
  first.getRandomValues(nextWords);
  createSeededCrypto(12345).getRandomValues(restartedWords);
  assert.notDeepEqual(nextWords, restartedWords);

  const zeroSeedWords = new Uint32Array(8);
  createSeededCrypto(0).getRandomValues(zeroSeedWords);
  assert.ok(zeroSeedWords.some(word => word !== 0), 'zero seed must normalize to nonzero state');
});

test('runtime map generation and decision functions are deterministic and available', () => {
  const first = createRuntime(12345);
  const second = createRuntime(12345);
  const config = { width: 7, height: 7, mineCount: 9, bombCount: 1 };
  const firstGame = new first.core.MineCore.Game(config);
  const secondGame = new second.core.MineCore.Game(config);

  assert.deepEqual(Array.from(firstGame.mines), Array.from(secondGame.mines));
  for (const id of ['heuristic', 'global-probability', 'constraint-probability']) {
    assert.equal(typeof first.decisions[id], 'function', `${id} decision is callable`);
    assert.equal(typeof second.decisions[id], 'function', `${id} decision is callable`);
  }
});

test('different seeds produce different deterministic random sequences', () => {
  const firstWords = new Uint32Array(8);
  const secondWords = new Uint32Array(8);
  createSeededCrypto(12345).getRandomValues(firstWords);
  createSeededCrypto(54321).getRandomValues(secondWords);

  assert.notDeepEqual(firstWords, secondWords);
});
