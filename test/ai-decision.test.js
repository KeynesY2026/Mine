const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: { MineCore: { randInt: length => length - 1 } } };
vm.runInNewContext(fs.readFileSync('js/ai-decision.js', 'utf8'), context);
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

const fallback = { type: 'open', x: 1, y: 1 };

test('invalid opens use the supplied public-policy fallback instead of random hidden cells', () => {
  const result = resolve(game([1, 0, 1, 0]), 'red',
    { type: 'open', x: 0, y: 0 }, { fallbackDecision: fallback, randomIndex: () => 0 });

  assert.deepEqual(plain(result), {
    action: fallback, invalid: true, noMoves: false,
  });
});

test('missing fallback uses deterministic legal open, not random all-hidden selection', () => {
  const result = resolve(game([0, 0, 0, 0]), 'red', null,
    { randomIndex: () => 3 });

  assert.deepEqual(plain(result), {
    action: { type: 'open', x: 0, y: 0 }, invalid: true, noMoves: false,
  });
});

test('out-of-range and already revealed opens are invalid', () => {
  const board = game([0, 1, 0, 1]);
  assert.equal(resolve(board, 'red', { type: 'open', x: -1, y: 0 }, { fallbackDecision: fallback }).invalid, true);
  assert.equal(resolve(board, 'red', { type: 'open', x: 1, y: 0 }, { fallbackDecision: fallback }).invalid, true);
});

test('no unopened cells do not produce a fallback move', () => {
  assert.deepEqual(plain(resolve(game([1, 1, 1, 1]), 'red', null,
    { fallbackDecision: fallback })), { action: null, invalid: false, noMoves: true });
});

test('bomb requests are rejected when the core denies AI bomb permission', () => {
  const result = resolve(game([0, 0, 0, 0], false), 'red',
    { type: 'bomb', x: 0, y: 0 }, { fallbackDecision: fallback });

  assert.deepEqual(plain(result), {
    action: fallback, invalid: true, noMoves: false,
  });
});

test('coordinate bombs stay coordinate actions regardless of legacy enhancement options', () => {
  for (const enhancedAI of [false, true]) {
    assert.deepEqual(plain(resolve(game([0, 0, 0, 0]), 'red',
      { type: 'bomb', x: 1, y: 0 }, { enhancedAI })), {
      action: { type: 'bomb', x: 1, y: 0 }, invalid: false, noMoves: false,
    });
  }
});

test('bomb-auto is accepted only with Invincible authorization and a legal coordinate fallback', () => {
  const result = resolve(game([0, 0, 0, 0]), 'red', {
    type: 'bomb-auto', fallback: { type: 'bomb', x: 1, y: 1 },
  }, {
    pluginId: 'constraint-probability', enhancedAI: true, fallbackDecision: fallback,
  });

  assert.deepEqual(plain(result), {
    action: { type: 'bomb-auto' }, fallbackAction: { type: 'bomb', x: 1, y: 1 },
    invalid: false, noMoves: false,
  });
});

test('bomb-auto authorization rejects other plugins, disabled mode and denied AI bombs', () => {
  const decision = { type: 'bomb-auto', fallback: { type: 'open', x: 1, y: 1 } };
  for (const options of [
    { pluginId: 'heuristic', enhancedAI: true },
    { pluginId: 'constraint-probability', enhancedAI: false },
  ]) {
    const result = resolve(game([0, 0, 0, 0]), 'red', decision, { ...options, fallbackDecision: fallback });
    assert.deepEqual(plain(result), { action: fallback, invalid: true, noMoves: false });
  }
  const denied = resolve(game([0, 0, 0, 0], false), 'red', decision, {
    pluginId: 'constraint-probability', enhancedAI: true, fallbackDecision: fallback,
  });
  assert.deepEqual(plain(denied), { action: fallback, invalid: true, noMoves: false });
});

test('bomb-auto with an invalid plugin fallback uses the scheduler public fallback', () => {
  const result = resolve(game([0, 0, 0, 0]), 'red', {
    type: 'bomb-auto', fallback: { type: 'open', x: -1, y: 0 },
  }, {
    pluginId: 'constraint-probability', enhancedAI: true, fallbackDecision: fallback,
  });

  assert.deepEqual(plain(result), { action: fallback, invalid: true, noMoves: false });
});

test('coordinate-free bomb-auto requests are rejected', () => {
  assert.deepEqual(plain(resolve(game([0, 0, 0, 0]), 'red',
    { type: 'bomb-auto' }, { fallbackDecision: fallback })), {
    action: fallback, invalid: true, noMoves: false,
  });
});

test('revealed bomb centers are rejected with the supplied public-policy fallback', () => {
  const result = resolve(game([1, 0, 1, 0]), 'red',
    { type: 'bomb', x: 0, y: 0 }, { fallbackDecision: fallback });

  assert.deepEqual(plain(result), {
    action: fallback, invalid: true, noMoves: false,
  });
});

test('invalid bomb coordinates use the supplied public-policy fallback', () => {
  const result = resolve(game([0, 0, 0, 0]), 'red',
    { type: 'bomb', x: 8, y: 0 }, { fallbackDecision: fallback });

  assert.deepEqual(plain(result), {
    action: fallback, invalid: true, noMoves: false,
  });
});
