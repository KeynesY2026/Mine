const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const plugins = {};
const sandbox = {
  window: { MineAIPlugins: { register(id, decide) { plugins[id] = decide; } } },
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

const Game = sandbox.window.MineCore.Game;
const CAPTURED_MINES = Array.from({ length: 25 }, (_, index) => index);

function capturedMineState(remainingMineIndices) {
  const board = new Game({ width: 15, height: 15, mineCount: 53, bombCount: 1 });
  board.mines.fill(0);
  for (const index of [...CAPTURED_MINES, ...remainingMineIndices]) board.mines[index] = 1;
  for (let index = 0; index < board.total; index++) {
    let adjacentMines = 0;
    sandbox.window.MineCore.eachNei(board.nb, index, neighbor => {
      if (board.mines[neighbor]) adjacentMines++;
    });
    board.numbers[index] = adjacentMines;
  }

  board.revealed.fill(0);
  board.owner.fill(0);
  for (const index of CAPTURED_MINES) {
    board.revealed[index] = 1;
    board.owner[index] = 2;
  }
  board.scores.blue = 0;
  board.scores.red = 25;
  board.bombs.blue = 1;
  board.turn = 'blue';
  board.hiddenCount = board.total - CAPTURED_MINES.length;
  return board;
}

function publicDecisionView(board) {
  const source = board.view('blue', { ai: true });
  const width = board.w, height = board.h;
  const values = Object.freeze(Array.from({ length: board.total }, (_, i) =>
    source.cellAt(i % width, Math.floor(i / width))));
  const snapshot = Object.freeze({
    width,
    height,
    mineCount: source.mineCount,
    remainMines: source.remainMines,
    cellAt(x, y) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return -2;
      return values[y * width + x];
    },
  });
  return Object.freeze({
    width: source.width,
    height: source.height,
    score: source.score,
    oppScore: source.oppScore,
    mineCount: source.mineCount,
    remainMines: source.remainMines,
    bombs: source.bombs,
    canBomb: source.canBomb,
    bombRadiusH: source.bombRadiusH,
    bombRadiusV: source.bombRadiusV,
    turn: source.turn,
    cellAt: snapshot.cellAt,
    analysis: sandbox.window.MineAIPlanner.analyze(snapshot),
  });
}

function publicProbabilityDistribution(view) {
  return Array.from({ length: view.width * view.height }, (_, index) => {
    const x = index % view.width, y = Math.floor(index / view.width);
    return view.cellAt(x, y) === -2 ? view.analysis.mineProbabilityAt(x, y) : null;
  });
}

test('public-only Invincible bombs use identical coordinates, not hidden auto-selection', () => {
  const left = capturedMineState(Array.from({ length: 28 }, (_, index) => index + 25));
  const right = capturedMineState(Array.from({ length: 28 }, (_, index) => index + 100));
  const leftView = publicDecisionView(left);
  const rightView = publicDecisionView(right);

  assert.equal(left.canBomb('blue', { ai: true }), true);
  assert.equal(right.canBomb('blue', { ai: true }), true);
  assert.equal(left.scores.blue, 0);
  assert.equal(left.scores.red, 25);
  assert.equal(left.bombs.blue, 1);
  assert.equal(left.mineCount, 53);
  assert.equal(left.hiddenCount, 200);
  assert.equal(left.revealed.reduce((sum, value) => sum + value, 0), 25);
  assert.equal(left.mines.reduce((sum, value) => sum + value, 0), 53);
  assert.equal(leftView.canBomb, true);
  assert.equal(rightView.canBomb, true);
  assert.equal(leftView.score, 0);
  assert.equal(leftView.oppScore, 25);
  assert.equal(leftView.oppScore - leftView.score, 25);
  assert.equal(leftView.remainMines, 28);
  assert.equal(leftView.bombs, 1);
  assert.equal(leftView.analysis.hiddenCells.length, 200);
  assert.notDeepEqual(Array.from(left.mines), Array.from(right.mines));

  const leftPublicCells = Array.from({ length: 225 }, (_, index) => leftView.cellAt(index % 15, Math.floor(index / 15)));
  const rightPublicCells = Array.from({ length: 225 }, (_, index) => rightView.cellAt(index % 15, Math.floor(index / 15)));
  assert.deepEqual(leftPublicCells, rightPublicCells);
  assert.deepEqual(publicProbabilityDistribution(leftView), publicProbabilityDistribution(rightView));
  assert.equal(leftView.analysis.quality, 'exact');
  assert.equal(rightView.analysis.quality, 'exact');
  assert.deepEqual(
    Array.from(leftView.analysis.bombCenters, item => [item.x, item.y, item.expectedMines, item.hiddenCount,
      Array.from(item.estimatedHitCountProbabilities)]),
    Array.from(rightView.analysis.bombCenters, item => [item.x, item.y, item.expectedMines, item.hiddenCount,
      Array.from(item.estimatedHitCountProbabilities)]),
  );

  const maximumExpectedYield = Math.max(...leftView.analysis.bombCenters.map(center => center.expectedMines));
  assert.ok(Math.abs(maximumExpectedYield - 3.5) < 1e-12);
  assert.ok(maximumExpectedYield < leftView.oppScore - leftView.score);

  const leftAction = plugins['constraint-probability'](leftView);
  const rightAction = plugins['constraint-probability'](rightView);
  assert.equal(leftAction.type, 'bomb');
  assert.deepEqual(JSON.parse(JSON.stringify(leftAction)), JSON.parse(JSON.stringify(rightAction)));
  assert.deepEqual(Object.keys(leftAction).sort(), ['type', 'x', 'y']);
  assert.ok(Number.isInteger(leftAction.x) && Number.isInteger(leftAction.y));
  assert.equal(leftView.cellAt(leftAction.x, leftAction.y), -2);

  // A stale caller's old enhanced-auto hint must not restore hidden-map selection.
  const legacyOptInAction = plugins['constraint-probability']({ ...leftView, enhancedAI: true });
  assert.deepEqual(JSON.parse(JSON.stringify(legacyOptInAction)), JSON.parse(JSON.stringify(leftAction)));
});
