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

test('runMatch completes a deterministic official-rule match', () => {
  const { runMatch } = require('../scripts/ai-tournament-runtime');
  const options = {
    seed: 12345,
    invincibleSide: 'blue',
    opponentId: 'heuristic',
    width: 7,
    height: 7,
    mineCount: 9,
    bombCount: 1,
  };
  const first = runMatch(options);
  const second = runMatch(options);

  assert.equal(first.winner, second.winner);
  assert.deepEqual(first.scores, second.scores);
  assert.equal(first.moveCount, second.moveCount);
  assert.equal(first.mapHash, second.mapHash);
  assert.ok(first.moveCount <= options.width * options.height + 1);
  assert.equal(first.scoreMargin, first.scores.blue - first.scores.red);
  assert.ok(first.bombsUsed >= 0 && first.bombsUsed <= options.bombCount);
  assert.ok(['blue', 'red', 'draw'].includes(first.winner));
  assert.equal(first.trace, undefined);
  assert.equal(Object.hasOwn(first, 'hiddenMap'), false);
});

test('runMatch traces public inputs and only attaches hidden map after completion', () => {
  const { runMatch } = require('../scripts/ai-tournament-runtime');
  const result = runMatch({
    seed: 54321,
    invincibleSide: 'red',
    opponentId: 'global-probability',
    width: 7,
    height: 7,
    mineCount: 9,
    bombCount: 1,
    includeTrace: true,
    includeHiddenMap: true,
  });

  assert.equal(result.trace.length, result.moveCount);
  assert.equal(result.hiddenMap.length, 49);
  assert.equal(result.hiddenMap.reduce((count, mine) => count + mine, 0), 9);
  for (const entry of result.trace) {
    assert.equal(Object.hasOwn(entry.view, 'mines'), false);
    assert.equal(Object.hasOwn(entry.view, 'mapHash'), false);
    assert.equal(Object.hasOwn(entry, 'hiddenMap'), false);
    assert.equal(entry.view.cells.length, 49);
    assert.deepEqual(Object.keys(entry.scoresBefore).sort(), ['blue', 'red']);
    assert.deepEqual(Object.keys(entry.bombsBefore).sort(), ['blue', 'red']);
    assert.ok(Array.isArray(entry.revealedCells));
  }
});
