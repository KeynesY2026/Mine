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
  assert.equal(board.analysis.freeMineProbability, 0.5);
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

test('Invincible bombs only when four points behind and coverage reaches two thirds', () => {
  const board = view(7, 7, Array(49).fill(-2), {
    mineCount: 30, remainMines: 30, bombs: 2, canBomb: true, oppScore: 4,
  });
  randomIndex(0);

  assert.equal(board.analysis.bombCoverageRatio(2), 39 / 49);
  assert.deepEqual(decide(board), { type: 'bomb', x: 2, y: 2 });

  const threeBehind = view(7, 7, Array(49).fill(-2), {
    mineCount: 30, remainMines: 30, bombs: 2, canBomb: true, oppScore: 3, enhancedAI: true,
  });
  assert.equal(decide(threeBehind).type, 'open');

  const exactlyTwoThirds = view(15, 1, Array(15).fill(-2), {
    mineCount: 8, remainMines: 8, bombs: 2, canBomb: true, oppScore: 4,
  });
  assert.equal(exactlyTwoThirds.analysis.bombCoverageRatio(2), 2 / 3);
  assert.equal(decide(exactlyTwoThirds).type, 'bomb');

  const tooLittleCoverage = view(15, 15, Array(225).fill(-2), {
    mineCount: 100, remainMines: 100, bombs: 2, canBomb: true, oppScore: 4, enhancedAI: true,
  });
  assert.ok(tooLittleCoverage.analysis.bombCoverageRatio(2) < 2 / 3);
  assert.equal(decide(tooLittleCoverage).type, 'open');
});

test('Invincible bomb yield uses fixed edge-clipped 5x5 centers and public expected mines', () => {
  const board = view(7, 7, Array(49).fill(-2), {
    mineCount: 30, remainMines: 30, bombs: 2, canBomb: true, oppScore: 4,
  });
  randomIndex(0);

  const action = decide(board);
  assert.deepEqual(action, { type: 'bomb', x: 2, y: 2 });
});

test('Invincible requests auto-bomb only when enhanced mode is enabled and includes a legal fallback', () => {
  const board = view(7, 7, Array(49).fill(-2), {
    mineCount: 30, remainMines: 30, bombs: 2, canBomb: true, oppScore: 4, enhancedAI: true,
  });
  randomIndex(0);

  const action = decide(board);

  assert.equal(action.type, 'bomb-auto');
  assert.ok(['open', 'bomb'].includes(action.fallback.type));
  assert.ok(action.fallback.x >= 0 && action.fallback.x < board.width);
  assert.ok(action.fallback.y >= 0 && action.fallback.y < board.height);
  assert.equal(board.cellAt(action.fallback.x, action.fallback.y), -2);
});

test('Invincible keeps coordinate actions when enhanced mode is disabled', () => {
  const board = view(7, 7, Array(49).fill(-2), {
    mineCount: 30, remainMines: 30, bombs: 2, canBomb: true, oppScore: 4, enhancedAI: false,
  });
  randomIndex(0);

  assert.deepEqual(decide(board), { type: 'bomb', x: 2, y: 2 });
});

test('Invincible does not request auto-bomb when no blast can physically reach the win line', () => {
  const board = view(15, 15, Array(225).fill(-2), {
    mineCount: 53, remainMines: 53, bombs: 1, canBomb: true, oppScore: 4, enhancedAI: true,
  });
  randomIndex(0);

  const action = decide(board);

  assert.equal(action.type, 'open');
  assert.equal(board.cellAt(action.x, action.y), -2);
});

test('Invincible requests a winning last bomb before opening a certain mine', () => {
  const cells = Array(9).fill(0);
  cells[0] = -2;
  for (const i of [1, 3, 4]) cells[i] = 1;
  const board = view(3, 3, cells, {
    mineCount: 1, remainMines: 1, bombs: 1, canBomb: true,
    score: 0, oppScore: 1, enhancedAI: true,
  });

  assert.equal(board.analysis.quality, 'exact');
  assert.deepEqual(Array.from(board.analysis.certainMines), [0]);
  const action = decide(board);

  assert.equal(action.type, 'bomb-auto');
  assert.equal(action.immediateWinOnly, true);
  assert.deepEqual(action.fallback, { type: 'open', x: 0, y: 0 });
});

test('Invincible requests immediate-win-only auto-bomb despite deficit, coverage, and expected-yield gates', () => {
  const cells = Array(225).fill(-2);
  for (let cell = 0; cell < 41; cell++) cells[cell] = -1;
  const board = view(15, 15, cells, {
    mineCount: 53, remainMines: 12, bombs: 1, canBomb: true,
    score: 20, oppScore: 21, enhancedAI: true,
  });
  randomIndex(0);

  assert.ok(Math.max(...board.analysis.bombCenters.map(candidate => candidate.expectedMines)) < 7);
  assert.ok(board.analysis.bombCoverageRatio(1) < 2 / 3);
  const action = decide(board);

  assert.equal(action.type, 'bomb-auto');
  assert.equal(action.immediateWinOnly, true);
  assert.equal(action.fallback.type, 'open');
  assert.equal(board.cellAt(action.fallback.x, action.fallback.y), -2);
});
