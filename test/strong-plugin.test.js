const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let makeDecision = null;
const sandbox = {
  window: {},
  crypto: { getRandomValues(array) { array[0] = 0; return array; } },
};
vm.createContext(sandbox);
for (const path of ['js/core.js', 'js/ai-planner.js']) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), sandbox);
}
sandbox.window.MineAIPlugins = {
  register(id, decide) {
    assert.equal(id, 'constraint-probability');
    makeDecision = decide;
  },
};
vm.runInContext(fs.readFileSync('plugin/ai-constraint-probability.js', 'utf8'), sandbox);

function view(width, height, cells, overrides = {}) {
  const defaults = {
    width, height,
    score: 0,
    oppScore: 0,
    mineCount: 1,
    remainMines: 1,
    bombs: 0,
    canBomb: false,
    turn: 'blue',
  };
  const values = Int8Array.from(cells);
  const state = { ...defaults, ...overrides };
  state.cellAt = (x, y) => x < 0 || y < 0 || x >= width || y >= height ? -2 : values[y * width + x];
  state.analysis = sandbox.window.MineAIPlanner.analyze(state);
  return state;
}

function decide(board) {
  assert.equal(typeof makeDecision, 'function', 'standalone plugin registers makeDecision(view)');
  return JSON.parse(JSON.stringify(makeDecision(board)));
}

function randomIndex(index) {
  sandbox.window.MineCore.randInt = length => Math.min(index, length - 1);
}

test('Invincible opens an exactly proven mine before ordinary candidates', () => {
  const cells = Array(9).fill(0);
  cells[0] = -2;
  for (const i of [1, 3, 4]) cells[i] = 1;
  const board = view(3, 3, cells);

  assert.deepEqual(Array.from(board.analysis.certainMines), [0]);
  assert.deepEqual(decide(board), { type: 'open', x: 0, y: 0 });
});

test('approximate probability 1 is not treated as a proven mine', () => {
  const board = view(3, 2, [-1, 0, -2, -2, -2, -2], {
    mineCount: 1,
    remainMines: 0,
  });
  assert.equal(board.analysis.quality, 'approximate');
  assert.deepEqual(Array.from(board.analysis.certainMines), []);
  assert.notDeepEqual(decide(board), { type: 'open', x: 0, y: 2 });
});

test('frontier with greater risk beats lower-risk free exploration', () => {
  const board = view(15, 1, [
    -2, 1, -2, 1, -2, -1, -1, -2, -2, -1, -2, 1, -2, 1, -2,
  ], { mineCount: 6, remainMines: 3 });
  randomIndex(0);

  assert.equal(board.analysis.mineProbabilityAt(2, 0), 0.75);
  assert.equal(board.analysis.freeMineProbability, 0.25);
  const action = decide(board);
  assert.equal(action.type, 'open');
  assert.ok([2, 12].includes(action.x));
});

test('equal frontier and free probabilities stay on the frontier', () => {
  const board = view(7, 1, [-2, 1, -2, -1, -1, -2, -2], {
    mineCount: 4, remainMines: 2,
  });
  randomIndex(0);

  assert.equal(board.analysis.mineProbabilityAt(0, 0), board.analysis.freeMineProbability);
  const action = decide(board);
  assert.equal(action.type, 'open');
  assert.ok([0, 2].includes(action.x));
});

test('strictly safer free cells are the only candidates when frontier risk is lower', () => {
  const board = view(3, 2, [0, -2, -2, -2, -2, -2]);
  randomIndex(0);

  const action = decide(board);
  assert.deepEqual(action, { type: 'open', x: 2, y: 0 });
  assert.ok(board.analysis.freeCells.includes(action.y * board.width + action.x));
});

test('tail-game local exploration near a revealed mine overrides lower-priority open choice', () => {
  const board = view(7, 1, [-2, -1, -2, -2, -2, -2, -2], {
    mineCount: 2, remainMines: 1, score: 1, oppScore: 0,
  });
  randomIndex(1);

  const action = decide(board);
  assert.equal(action.type, 'open');
  assert.ok([0, 2].includes(action.x));
});

test('Invincible bomb yield uses fixed edge-clipped 5x5 centers and public expected mines', () => {
  const board = view(7, 7, Array(49).fill(-2), {
    mineCount: 30, remainMines: 30, bombs: 2, canBomb: true, oppScore: 1,
  });
  randomIndex(0);

  const action = decide(board);
  assert.deepEqual(action, { type: 'bomb', x: 2, y: 2 });
});

test('Invincible does not spend its last bomb below the winning expected-yield threshold', () => {
  const board = view(7, 7, Array(49).fill(-2), {
    mineCount: 11, remainMines: 11, bombs: 1, canBomb: true, oppScore: 1,
  });

  const action = decide(board);
  assert.equal(action.type, 'open');
});
