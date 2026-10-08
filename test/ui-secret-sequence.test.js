const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadUiGate() {
  const elements = new Map();
  const element = () => ({
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: {}, children: [],
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    addEventListener() {},
    body: element(),
  };
  const window = {
    MineAIConfig: { defaultBySide: { red: 'heuristic' } },
    addEventListener() {},
  };
  const context = {
    window, document,
    MineCore: {},
    MineAIRegistry: { create: () => ({}) },
    MineAIDecision: {},
    MineGameSettings: {},
    MineFeedback: { capturedMineIndices: () => [] },
    MineIcons: { mineSvg: () => '', bombSvg: () => '', counterMineSvg: () => '' },
    MineBoardLayout: { cellSize: () => 24 },
    MineTurnTimer: { create: () => ({}) },
    MineVictoryCelebration: { create: () => ({}) },
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  vm.runInNewContext(fs.readFileSync('js/key-sequence.js', 'utf8'), context);
  let detector;
  const create = window.MineKeySequence.create;
  window.MineKeySequence.create = (secret, timeoutMs) => {
    detector = create(secret, timeoutMs);
    return detector;
  };
  context.MineKeySequence = window.MineKeySequence;
  vm.runInNewContext(fs.readFileSync('js/ui.js', 'utf8'), context);
  return detector;
}

test('the browser UI unlocks its cheat gate with cheat', () => {
  const gate = loadUiGate();
  assert.equal(gate.isUnlocked(), false);
  for (const [index, key] of Array.from('cheat').entries()) {
    assert.equal(gate.push(key, index * 100), index === 4);
  }
  assert.equal(gate.isUnlocked(), true);
});

test('the browser UI no longer unlocks its cheat gate with the former phrase', () => {
  const gate = loadUiGate();
  for (const [index, key] of Array.from('keynesy').entries()) gate.push(key, index * 100);
  assert.equal(gate.isUnlocked(), false);
});
