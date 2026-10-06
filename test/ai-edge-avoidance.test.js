const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const plugins = {};
let randomWord = 0;
const sandbox = {
  window: {
    MineAIPlugins: { register(id, decide) { plugins[id] = decide; } },
  },
  crypto: { getRandomValues(array) { array[0] = randomWord; return array; } },
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
    bombs: 0, canBomb: false, bombRadiusH: 2, bombRadiusV: 2, turn: 'blue', ...overrides,
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

function withBombCenters(board, candidates) {
  board.analysis = Object.freeze({
    ...board.analysis,
    bombCenters: Object.freeze(candidates.map(candidate => Object.freeze(candidate))),
  });
  return board;
}

test('Simple waits until two points behind, then must use an available bomb', () => {
  randomWord = 0;
  const candidates = [
    { x: 0, y: 0, expectedMines: 3, hiddenCount: 25 },
    { x: 5, y: 5, expectedMines: 9, hiddenCount: 9 },
  ];
  const oneBehind = withBombCenters(view(35, 35, Array(35 * 35).fill(-2), {
    mineCount: 50, remainMines: 50, bombs: 1, canBomb: true, score: 0, oppScore: 1,
  }), candidates);
  const twoBehind = withBombCenters(view(35, 35, Array(35 * 35).fill(-2), {
    mineCount: 50, remainMines: 50, bombs: 1, canBomb: true, score: 0, oppScore: 2,
  }), candidates);

  assert.equal(sandbox.window.MineCore.weakDecide(oneBehind).type, 'open');
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.MineCore.weakDecide(twoBehind))), {
    type: 'bomb', x: 0, y: 0,
  });
});

test('Simple bombs while trailing and targets the blast covering most hidden cells', () => {
  randomWord = 0;
  const board = withBombCenters(view(35, 35, Array(35 * 35).fill(-2), {
    mineCount: 50, remainMines: 50, bombs: 1, canBomb: true, score: 0, oppScore: 3,
  }), [
    { x: 0, y: 0, expectedMines: 3, hiddenCount: 25 },
    { x: 5, y: 5, expectedMines: 9, hiddenCount: 9 },
  ]);

  const action = sandbox.window.MineCore.weakDecide(board);

  assert.deepEqual(JSON.parse(JSON.stringify(action)), { type: 'bomb', x: 0, y: 0 });
});

test('Medium requires a three-point deficit and enough distinct bomb coverage', () => {
  const cells = Array(15).fill(-2);
  const twoBombsAtThreeBehind = view(15, 1, cells, {
    mineCount: 7, remainMines: 7, bombs: 2, canBomb: true, score: 0, oppScore: 3,
  });
  const oneBombAtThreeBehind = view(15, 1, cells, {
    mineCount: 7, remainMines: 7, bombs: 1, canBomb: true, score: 0, oppScore: 3,
  });
  const twoBombsAtTwoBehind = view(15, 1, cells, {
    mineCount: 7, remainMines: 7, bombs: 2, canBomb: true, score: 0, oppScore: 2,
  });

  assert.equal(twoBombsAtThreeBehind.analysis.bombCoverageRatio(2), 2 / 3);
  assert.equal(oneBombAtThreeBehind.analysis.bombCoverageRatio(1), 1 / 3);
  assert.equal(sandbox.window.MineCore.strongDecide(oneBombAtThreeBehind).type, 'open');
  assert.equal(sandbox.window.MineCore.strongDecide(twoBombsAtTwoBehind).type, 'open');
  assert.equal(sandbox.window.MineCore.strongDecide(twoBombsAtThreeBehind).type, 'bomb');

  const exactlyHalfCovered = view(10, 1, Array(10).fill(-2), {
    mineCount: 5, remainMines: 5, bombs: 1, canBomb: true, score: 0, oppScore: 3,
  });
  assert.equal(exactlyHalfCovered.analysis.bombCoverageRatio(1), 0.5);
  assert.equal(sandbox.window.MineCore.strongDecide(exactlyHalfCovered).type, 'bomb');
});

test('Medium chooses the blast with the greatest expected yield when coverage qualifies', () => {
  const board = view(7, 7, Array(49).fill(-2), {
    mineCount: 30, remainMines: 30, bombs: 1, canBomb: true, score: 0, oppScore: 3,
  });
  const candidates = [
    { x: 0, y: 0, expectedMines: 1.25, hiddenCount: 9 },
    { x: 2, y: 2, expectedMines: 2.5, hiddenCount: 25 },
  ];
  board.analysis = Object.freeze({
    ...board.analysis,
    bombCenters: Object.freeze(candidates.map(candidate => Object.freeze(candidate))),
  });

  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.MineCore.strongDecide(board))), {
    type: 'bomb', x: 2, y: 2,
  });
});

test('probability solver is absent from AI plugin side effects', () => {
  assert.equal(typeof sandbox.window.MineCore.computeProbabilities, 'undefined');
});
