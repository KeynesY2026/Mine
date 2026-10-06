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

function boardWithMines(indices) {
  const board = new sandbox.window.MineCore.Game({ width: 7, height: 7, mineCount: 6, bombCount: 1 });
  board.mines.fill(0);
  for (const index of indices) board.mines[index] = 1;
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

test('different hidden layouts with identical public views yield identical analyses and AI choices', () => {
  const left = boardWithMines([0, 2, 4, 6, 8, 10]);
  const right = boardWithMines([36, 38, 40, 42, 44, 46]);
  const leftView = publicDecisionView(left);
  const rightView = publicDecisionView(right);

  assert.notDeepEqual(Array.from(left.mines), Array.from(right.mines));
  assert.deepEqual(
    Array.from({ length: 49 }, (_, i) => leftView.cellAt(i % 7, Math.floor(i / 7))),
    Array.from({ length: 49 }, (_, i) => rightView.cellAt(i % 7, Math.floor(i / 7))),
  );
  assert.equal(leftView.analysis.quality, rightView.analysis.quality);
  assert.deepEqual(Array.from(leftView.analysis.hiddenCells), Array.from(rightView.analysis.hiddenCells));
  assert.deepEqual(Array.from(leftView.analysis.bombCenters, item => [item.x, item.y, item.expectedMines]),
    Array.from(rightView.analysis.bombCenters, item => [item.x, item.y, item.expectedMines]));

  const leftActions = [
    sandbox.window.MineCore.weakDecide(leftView),
    sandbox.window.MineCore.strongDecide(leftView),
    plugins['constraint-probability'](leftView),
  ];
  const rightActions = [
    sandbox.window.MineCore.weakDecide(rightView),
    sandbox.window.MineCore.strongDecide(rightView),
    plugins['constraint-probability'](rightView),
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(leftActions)), JSON.parse(JSON.stringify(rightActions)));
});
