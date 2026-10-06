const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const plugins = {};
const sandbox = {
  window: {
    MineAIPlugins: { register(id, decide) { plugins[id] = decide; } },
  },
  crypto: { getRandomValues(array) { array[0] = 0; return array; } },
};
vm.createContext(sandbox);
for (const path of [
  'js/core.js',
  'js/ai-planner.js',
  'plugin/ai-heuristic.js',
  'plugin/ai-global-probability.js',
  'plugin/ai-constraint-probability.js',
]) vm.runInContext(fs.readFileSync(path, 'utf8'), sandbox);

function view(width, height, cells, overrides = {}) {
  const values = Int8Array.from(cells);
  const state = {
    width, height, score: 0, oppScore: 0, mineCount: 1, remainMines: 1,
    bombs: 0, canBomb: false, turn: 'blue', ...overrides,
    cellAt(x, y) { return values[y * width + x]; },
  };
  state.analysis = sandbox.window.MineAIPlanner.analyze(state);
  return state;
}

function isEdge(action, width, height) {
  return action.x === 0 || action.y === 0 || action.x === width - 1 || action.y === height - 1;
}

test('heuristic AI preserves its interior preference when equal-risk candidates exist', () => {
  const board = view(5, 5, Array(25).fill(-2), { mineCount: 5, remainMines: 5 });

  const action = sandbox.window.MineCore.weakDecide(board);

  assert.equal(action.type, 'open');
  assert.equal(isEdge(action, board.width, board.height), false);
});

test('global-probability AI preserves its interior preference when equal-risk candidates exist', () => {
  const board = view(5, 5, Array(25).fill(-2), { mineCount: 5, remainMines: 5 });

  const action = sandbox.window.MineCore.strongDecide(board);

  assert.equal(action.type, 'open');
  assert.equal(isEdge(action, board.width, board.height), false);
});

test('simple and medium AIs can use an edge when no interior cell remains', () => {
  const cells = Array(25).fill(0);
  cells[2 * 5] = -2;
  const board = view(5, 5, cells, { mineCount: 0, remainMines: 0 });

  for (const decide of [sandbox.window.MineCore.weakDecide, sandbox.window.MineCore.strongDecide]) {
    const action = decide(board);
    assert.equal(action.type, 'open');
    assert.equal(isEdge(action, board.width, board.height), true);
  }
});

test('Invincible opens a certain edge mine despite safer-looking alternatives', () => {
  const cells = Array(9).fill(0);
  cells[0] = -2;
  for (const i of [1, 3, 4]) cells[i] = 1;
  const board = view(3, 3, cells);

  const action = plugins['constraint-probability'](board);
  assert.deepEqual(JSON.parse(JSON.stringify(action)), { type: 'open', x: 0, y: 0 });
});

test('Simple and Medium keep prioritizing a proven edge mine over interior cells', () => {
  const width = 7, height = 7;
  const cells = Array(width * height).fill(0);
  cells[3 * width] = -2;
  cells[3 * width + 3] = -2;
  for (const [x, y] of [[0, 2], [0, 4], [1, 2], [1, 3], [1, 4]]) cells[y * width + x] = 1;
  const board = view(width, height, cells, { mineCount: 1, remainMines: 1 });

  assert.equal(board.analysis.quality, 'exact');
  assert.equal(board.analysis.mineProbabilityAt(0, 3), 1);
  assert.equal(board.analysis.mineProbabilityAt(3, 3), 0);
  for (const decide of [sandbox.window.MineCore.weakDecide, sandbox.window.MineCore.strongDecide]) {
    assert.deepEqual(JSON.parse(JSON.stringify(decide(board))), { type: 'open', x: 0, y: 3 });
  }
});

test('probability solver is absent from AI plugin side effects', () => {
  assert.equal(typeof sandbox.window.MineCore.computeProbabilities, 'undefined');
});
