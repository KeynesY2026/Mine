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

test('Invincible spends when maximum expected blast yield cannot tie, otherwise conserves', () => {
  const desperateCells = Array(225).fill(-2);
  for (let cell = 0; cell < 25; cell++) desperateCells[cell] = -1;
  const desperate = view(15, 15, desperateCells, {
    mineCount: 53, remainMines: 28, bombs: 1, canBomb: true, score: 0, oppScore: 25,
  });
  randomIndex(0);
  const maximum = Math.max(...desperate.analysis.bombCenters.map(candidate => candidate.expectedMines));
  assert.equal(desperate.analysis.singlePossibleMineRegion, false);
  assert.ok(maximum < desperate.oppScore - desperate.score);
  const action = decide(desperate);
  const best = desperate.analysis.bombCenters.find(candidate => candidate.expectedMines === maximum);
  assert.deepEqual(action, { type: 'bomb', x: best.x, y: best.y });

  const recoverableCells = Array(225).fill(-2);
  for (let cell = 0; cell < 5; cell++) recoverableCells[cell] = -1;
  const recoverable = view(15, 15, recoverableCells, {
    mineCount: 53, remainMines: 48, bombs: 1, canBomb: true, score: 0, oppScore: 5,
  });
  assert.ok(Math.max(...recoverable.analysis.bombCenters.map(candidate => candidate.expectedMines)) >= 5);
  assert.equal(decide(recoverable).type, 'open');

  const boundary = view(3, 2, Array(6).fill(-2), {
    mineCount: 1, remainMines: 1, bombs: 1, canBomb: true, score: 0, oppScore: 1,
  });
  boundary.analysis = {
    ...boundary.analysis,
    singlePossibleMineRegion: false,
    bombCenters: [{ x: 1, y: 0, hiddenCount: 1, expectedMines: 1, estimatedHitCountProbabilities: [0, 1] }],
  };
  assert.equal(decide(boundary).type, 'open');

  const noCenters = view(3, 2, Array(6).fill(-2), {
    mineCount: 1, remainMines: 1, bombs: 1, canBomb: true, score: 0, oppScore: 2,
  });
  noCenters.analysis = { ...noCenters.analysis, singlePossibleMineRegion: false, bombCenters: [] };
  assert.equal(decide(noCenters).type, 'open');
});

test('Invincible uses a legal last-region bomb and selects the best public win estimate', () => {
  const width = 7, height = 7;
  const hidden = [23, 24, 25];
  const captured = [0, 48];
  const mines = [...hidden, ...captured];
  const cells = Array(width * height).fill(-2);
  for (let index = 0; index < cells.length; index++) {
    if (hidden.includes(index)) continue;
    if (captured.includes(index)) { cells[index] = -1; continue; }
    const x = index % width, y = Math.floor(index / width);
    let adjacent = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < width && ny < height && mines.includes(ny * width + nx)) adjacent++;
    }
    cells[index] = adjacent;
  }
  const certainRegion = view(width, height, cells, {
    mineCount: 5, remainMines: 3, bombs: 1, canBomb: true, score: 0, oppScore: 2,
  });
  assert.equal(certainRegion.analysis.quality, 'exact');
  assert.equal(certainRegion.analysis.singlePossibleMineRegion, true);
  assert.deepEqual(Array.from(certainRegion.analysis.hiddenCells), hidden);
  const action = decide(certainRegion);
  const selected = certainRegion.analysis.bombCenters.find(candidate => candidate.x === action.x && candidate.y === action.y);
  assert.equal(action.type, 'bomb');
  assert.equal(selected.estimatedHitCountProbabilities[3], 1);

  const estimated = view(3, 2, Array(6).fill(-2), {
    mineCount: 5, remainMines: 5, bombs: 1, canBomb: true, score: 1, oppScore: 2,
  });
  estimated.analysis = {
    ...estimated.analysis,
    singlePossibleMineRegion: true,
    bombCenters: [
      { x: 0, y: 0, hiddenCount: 2, expectedMines: 1, estimatedHitCountProbabilities: [0.5, 0, 0.5] },
      { x: 1, y: 0, hiddenCount: 2, expectedMines: 1.25, estimatedHitCountProbabilities: [0, 0.75, 0.25] },
    ],
  };
  assert.deepEqual(decide(estimated), { type: 'bomb', x: 0, y: 0 });

  estimated.analysis = {
    ...estimated.analysis,
    bombCenters: [
      { x: 0, y: 0, hiddenCount: 2, expectedMines: 1, estimatedHitCountProbabilities: [0.5, 0, 0.5] },
      { x: 1, y: 0, hiddenCount: 2, expectedMines: 1.5, estimatedHitCountProbabilities: [0.5, 0, 0.5] },
    ],
  };
  assert.deepEqual(decide(estimated), { type: 'bomb', x: 1, y: 0 });
});

test('Invincible runs the bomb policy before opening an exactly certain mine', () => {
  const cells = [
    -1, 1, 0, 0, -2, -2, -2,
    -2, -2, 1, -2, -2, 4, -1,
    -2, -2, -1, -2, -2, -2, -1,
    0, -2, 1, 2, 3, -1, 3,
    1, 2, 2, 2, 2, 1, 1,
    -1, -2, -1, -2, -2, -2, 0,
    1, 2, -2, 2, 1, 0, 0,
  ];
  const board = view(7, 7, cells, {
    mineCount: 10, remainMines: 3, bombs: 1, canBomb: true, score: 2, oppScore: 5,
  });
  assert.equal(board.analysis.quality, 'exact');
  assert.ok(board.analysis.certainMines.length > 0);
  assert.equal(board.analysis.singlePossibleMineRegion, false);
  assert.ok(Math.max(...board.analysis.bombCenters.map(candidate => candidate.expectedMines)) < 3);
  assert.equal(decide(board).type, 'bomb');
});

test('Invincible never bombs while leading, when bombing is disallowed, or without inventory', () => {
  const cells = Array(49).fill(-2);
  const leading = view(7, 7, cells, {
    mineCount: 20, remainMines: 20, bombs: 1, canBomb: true, score: 3, oppScore: 2,
  });
  assert.equal(decide(leading).type, 'open');

  const disabled = view(7, 7, cells, {
    mineCount: 20, remainMines: 20, bombs: 1, canBomb: false, score: 0, oppScore: 5,
  });
  assert.equal(decide(disabled).type, 'open');

  const emptyInventory = view(7, 7, cells, {
    mineCount: 20, remainMines: 20, bombs: 0, canBomb: true, score: 0, oppScore: 5,
  });
  assert.equal(decide(emptyInventory).type, 'open');
});
