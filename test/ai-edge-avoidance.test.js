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
  'plugin/ai-heuristic.js',
  'plugin/ai-global-probability.js',
  'plugin/ai-constraint-probability.js',
]) {
  vm.runInContext(fs.readFileSync(path, 'utf8'), sandbox);
}

function view(width, height, cells, overrides = {}) {
  return {
    width,
    height,
    score: 0,
    oppScore: 0,
    mineCount: 1,
    remainMines: 1,
    bombs: 0,
    canBomb: false,
    bombRadiusH: 0,
    bombRadiusV: 0,
    turn: 'blue',
    cellAt(x, y) { return cells[y * width + x]; },
    ...overrides,
  };
}

function isEdge(action, width, height) {
  return action.x === 0 || action.y === 0 || action.x === width - 1 || action.y === height - 1;
}

test('heuristic AI prefers a hidden interior cell when one is available', () => {
  const board = view(5, 5, Array(25).fill(-2), { mineCount: 5, remainMines: 5 });

  const action = sandbox.window.MineCore.weakDecide(board);

  assert.equal(action.type, 'open');
  assert.equal(isEdge(action, board.width, board.height), false);
});

test('heuristic AI opens a certain edge mine despite interior alternatives', () => {
  const forcedSandbox = {
    window: {},
    crypto: { getRandomValues(array) { array[0] = 0; return array; } },
  };
  vm.createContext(forcedSandbox);
  vm.runInContext(fs.readFileSync('js/core.js', 'utf8'), forcedSandbox);
  const heuristic = fs.readFileSync('plugin/ai-heuristic.js', 'utf8');
  const injection = '  const hidden = [];';
  assert.ok(heuristic.includes(injection));
  vm.runInContext(heuristic.replace(injection, '  val[0] = 100;\n' + injection), forcedSandbox);

  const cells = Array(25).fill(0);
  cells[0] = -2;
  cells[2 * 5 + 2] = -2;
  const action = forcedSandbox.window.MineCore.weakDecide(view(5, 5, cells));

  assert.deepEqual(JSON.parse(JSON.stringify(action)), { type: 'open', x: 0, y: 0 });
});

test('heuristic AI can use an edge when no interior cell remains', () => {
  const cells = Array(25).fill(0);
  cells[2 * 5] = -2;
  const board = view(5, 5, cells);

  const action = sandbox.window.MineCore.weakDecide(board);

  assert.equal(action.type, 'open');
  assert.equal(isEdge(action, board.width, board.height), true);
});

test('global-probability AI prefers a hidden interior cell when one is available', () => {
  const board = view(5, 5, Array(25).fill(-2), { mineCount: 5, remainMines: 5 });

  const action = sandbox.window.MineCore.strongDecide(board);

  assert.equal(action.type, 'open');
  assert.equal(isEdge(action, board.width, board.height), false);
});

test('global-probability AI can use an edge when no interior cell remains', () => {
  const cells = Array(25).fill(0);
  cells[2 * 5] = -2;
  const board = view(5, 5, cells);

  const action = sandbox.window.MineCore.strongDecide(board);

  assert.equal(action.type, 'open');
  assert.equal(isEdge(action, board.width, board.height), true);
});

test('constraint-probability AI opens a certain edge mine despite interior alternatives', () => {
  const width = 7, height = 7;
  const cells = Array(width * height).fill(0);
  cells[3 * width] = -2;
  cells[3 * width + 3] = -2;
  for (const [x, y] of [[0, 2], [0, 4], [1, 2], [1, 3], [1, 4]]) {
    cells[y * width + x] = 1;
  }
  const board = view(width, height, cells, { mineCount: 1, remainMines: 1 });

  const action = plugins['constraint-probability'](board);

  assert.deepEqual(JSON.parse(JSON.stringify(action)), { type: 'open', x: 0, y: 3 });
});

test('global-probability AI opens a certain edge mine despite interior alternatives', () => {
  const width = 7, height = 7;
  const cells = Array(width * height).fill(0);
  cells[3 * width] = -2;
  cells[3 * width + 3] = -2;
  for (const [x, y] of [[0, 2], [0, 4], [1, 2], [1, 3], [1, 4]]) {
    cells[y * width + x] = 1;
  }
  const board = view(width, height, cells, { mineCount: 1, remainMines: 1 });

  const probabilities = sandbox.window.MineCore.computeProbabilities(board);
  assert.equal(probabilities.get(3 * width), 1);
  assert.equal(probabilities.get(3 * width + 3), 0);

  const action = sandbox.window.MineCore.strongDecide(board);

  assert.deepEqual(JSON.parse(JSON.stringify(action)), { type: 'open', x: 0, y: 3 });
});

test('constraint-probability AI can use an edge when no interior cell remains', () => {
  const cells = Array(25).fill(0);
  cells[2 * 5] = -2;
  const board = view(5, 5, cells, { mineCount: 0, remainMines: 0 });

  const action = plugins['constraint-probability'](board);

  assert.equal(action.type, 'open');
  assert.equal(isEdge(action, board.width, board.height), true);
});
