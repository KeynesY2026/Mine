const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  window: { MineCore: { randInt: length => length - 1 } },
  Math: Object.assign(Object.create(Math), { random: () => 0 }),
};
const source = fs.existsSync('js/ai-decision.js') ? fs.readFileSync('js/ai-decision.js', 'utf8') : '';
vm.runInNewContext(source, context);
const resolve = context.window.MineAIDecision?.resolve;

function game(revealed, canBomb = true) {
  return {
    w: 2,
    h: 2,
    revealed: Uint8Array.from(revealed),
    canBomb(player, options) {
      assert.equal(player, 'red');
      assert.deepEqual(JSON.parse(JSON.stringify(options)), { ai: true });
      return canBomb;
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('invalid opens fall back to a random legal unopened cell', () => {
  assert.equal(typeof resolve, 'function', 'decision normalizer is available');
  const result = resolve(game([1, 0, 1, 0]), 'red',
    { type: 'open', x: 0, y: 0 }, { randomIndex: () => 1 });

  assert.deepEqual(plain(result), {
    action: { type: 'open', x: 1, y: 1 }, invalid: true, noMoves: false,
  });
});

test('default invalid-action fallback uses the core secure random index', () => {
  const result = resolve(game([0, 0, 0, 0]), 'red', null);

  assert.deepEqual(plain(result), {
    action: { type: 'open', x: 1, y: 1 }, invalid: true, noMoves: false,
  });
});

test('out-of-range and already revealed opens are invalid', () => {
  const board = game([0, 1, 0, 1]);
  assert.equal(resolve(board, 'red', { type: 'open', x: -1, y: 0 }, { randomIndex: () => 0 }).invalid, true);
  assert.equal(resolve(board, 'red', { type: 'open', x: 1, y: 0 }, { randomIndex: () => 0 }).invalid, true);
});

test('no unopened cells do not produce a fallback move', () => {
  assert.deepEqual(plain(resolve(game([1, 1, 1, 1]), 'red', null,
    { randomIndex: () => 0 })), { action: null, invalid: false, noMoves: true });
});

test('bomb requests are rejected when the core denies AI bomb permission', () => {
  const result = resolve(game([0, 0, 0, 0], false), 'red',
    { type: 'bomb', x: 0, y: 0 }, { randomIndex: () => 2 });

  assert.deepEqual(plain(result), {
    action: { type: 'open', x: 0, y: 1 }, invalid: true, noMoves: false,
  });
});

test('coordinate bombs remain coordinate actions when enhanced mode is off', () => {
  assert.deepEqual(plain(resolve(game([0, 0, 0, 0]), 'red',
    { type: 'bomb', x: 1, y: 0 }, { enhancedAI: false })), {
    action: { type: 'bomb', x: 1, y: 0 }, invalid: false, noMoves: false,
  });
});

test('enhanced bomb requests discard coordinates and become coordinate-free actions', () => {
  assert.deepEqual(plain(resolve(game([0, 0, 0, 0]), 'red',
    { type: 'bomb', x: 1, y: 0 }, { enhancedAI: true })), {
    action: { type: 'bomb-auto' }, invalid: false, noMoves: false,
  });
});

test('invalid bomb coordinates fall back to a legal open', () => {
  const result = resolve(game([0, 0, 0, 0]), 'red',
    { type: 'bomb', x: 8, y: 0 }, { enhancedAI: false, randomIndex: () => 3 });

  assert.deepEqual(plain(result), {
    action: { type: 'open', x: 1, y: 1 }, invalid: true, noMoves: false,
  });
});
