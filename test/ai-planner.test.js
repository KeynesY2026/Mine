const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  window: {},
  crypto: { getRandomValues: array => { array[0] = 0; return array; } },
};
vm.runInNewContext(fs.readFileSync('js/core.js', 'utf8'), context);
const plannerSource = fs.existsSync('js/ai-planner.js') ? fs.readFileSync('js/ai-planner.js', 'utf8') : '';
vm.runInNewContext(plannerSource, context);
const planner = context.window.MineAIPlanner;

function view(width, height, cells, remainMines, mineCount = remainMines) {
  const values = Int8Array.from(cells);
  return {
    width,
    height,
    mineCount,
    remainMines,
    cellAt(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return -2;
      return values[y * width + x];
    },
  };
}

function bruteForceProbabilities(board) {
  const hidden = [];
  for (let i = 0; i < board.width * board.height; i++) {
    if (board.cellAt(i % board.width, Math.floor(i / board.width)) === -2) hidden.push(i);
  }
  const valid = [];
  for (let mask = 0; mask < 2 ** hidden.length; mask++) {
    let mines = 0;
    for (let bit = 0; bit < hidden.length; bit++) mines += (mask >> bit) & 1;
    if (mines !== board.remainMines) continue;
    let satisfies = true;
    for (let y = 0; y < board.height && satisfies; y++) for (let x = 0; x < board.width && satisfies; x++) {
      const clue = board.cellAt(x, y);
      if (clue < 0) continue;
      let adjacentMines = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= board.width || ny >= board.height) continue;
        const index = ny * board.width + nx;
        if (board.cellAt(nx, ny) === -1) adjacentMines++;
        else {
          const hiddenIndex = hidden.indexOf(index);
          if (hiddenIndex >= 0 && ((mask >> hiddenIndex) & 1)) adjacentMines++;
        }
      }
      if (adjacentMines !== clue) satisfies = false;
    }
    if (satisfies) valid.push(mask);
  }
  assert.ok(valid.length > 0, 'oracle fixture must have at least one satisfying layout');
  return new Map(hidden.map((cell, bit) => [cell,
    valid.filter(mask => (mask >> bit) & 1).length / valid.length]));
}

test('planner returns exact marginals matching equal-weight public configurations', () => {
  assert.equal(typeof planner?.analyze, 'function', 'planner exposes analyze(publicView)');
  const board = view(3, 2, [0, -2, -2, -2, -2, -2], 1);
  const analysis = planner.analyze(board);
  const oracle = bruteForceProbabilities(board);

  assert.equal(analysis.quality, 'exact');
  for (const [cell, probability] of oracle) {
    assert.ok(Math.abs(analysis.mineProbabilityAt(cell % board.width, Math.floor(cell / board.width)) - probability) < 1e-12);
  }
  assert.deepEqual(Array.from(analysis.frontierCells), [1, 3, 4]);
  assert.deepEqual(Array.from(analysis.freeCells), [2, 5]);
  assert.equal(analysis.freeMineProbability, 0.5);
});

test('approximate analysis never exposes certainty and covers every hidden cell', () => {
  assert.equal(typeof planner?.analyze, 'function', 'planner exposes analyze(publicView)');
  const board = view(3, 2, [-1, 0, -2, -2, -2, -2], 0, 1);
  const analysis = planner.analyze(board);
  const probabilities = analysis.hiddenCells.map(cell =>
    analysis.mineProbabilityAt(cell % board.width, Math.floor(cell / board.width)));

  assert.equal(analysis.quality, 'approximate');
  assert.deepEqual(Array.from(analysis.certainMines), []);
  assert.deepEqual(Array.from(analysis.certainSafes), []);
  assert.equal(probabilities.length, 4);
  assert.ok(probabilities.every(p => Number.isFinite(p) && p >= 0 && p <= 1));
  assert.ok(analysis.error);
});

test('separate frontier clusters combine with free-cell combinations before marginals are computed', () => {
  assert.equal(typeof planner?.analyze, 'function', 'planner exposes analyze(publicView)');
  const board = view(15, 1, [
    -2, 1, -2, 1, -2, -1, -1, -2, -2, -1, -2, 1, -2, 1, -2,
  ], 3, 6);
  const analysis = planner.analyze(board);
  const oracle = bruteForceProbabilities(board);

  assert.equal(analysis.quality, 'exact');
  assert.deepEqual(Array.from(analysis.frontierCells), [0, 2, 4, 10, 12, 14]);
  assert.deepEqual(Array.from(analysis.freeCells), [7, 8]);
  for (const [cell, probability] of oracle) {
    assert.ok(Math.abs(analysis.mineProbabilityAt(cell, 0) - probability) < 1e-12);
  }
  assert.equal(analysis.mineProbabilityAt(0, 0), 0.25);
  assert.equal(analysis.mineProbabilityAt(2, 0), 0.75);
  assert.equal(analysis.freeMineProbability, 0.25);
});

test('public fallback follows frontier/free policy and returns only a legal hidden cell', () => {
  assert.equal(typeof planner?.chooseFallback, 'function', 'planner exposes a public-state fallback selector');
  const board = view(3, 2, [0, -2, -2, -2, -2, -2], 1);
  const analysis = planner.analyze(board);
  const action = planner.chooseFallback(board, analysis, () => 0);

  assert.deepEqual(JSON.parse(JSON.stringify(action)), { type: 'open', x: 2, y: 0 });
});

test('analysis rates fixed 5x5 bomb centers with edge-clipped expected yields', () => {
  assert.equal(typeof planner?.analyze, 'function', 'planner exposes analyze(publicView)');
  const board = view(7, 7, Array(49).fill(-2), 49);
  const analysis = planner.analyze(board);
  const byCenter = new Map(analysis.bombCenters.map(candidate => [`${candidate.x},${candidate.y}`, candidate]));

  assert.deepEqual(JSON.parse(JSON.stringify(byCenter.get('0,0'))), { x: 0, y: 0, expectedMines: 9, hiddenCount: 9 });
  assert.deepEqual(JSON.parse(JSON.stringify(byCenter.get('3,3'))), { x: 3, y: 3, expectedMines: 25, hiddenCount: 25 });
  assert.equal(analysis.bombCenters.length, 49);
});

test('planner rejects invalid dimensions, mine totals and visible values', () => {
  assert.equal(typeof planner?.analyze, 'function', 'planner exposes analyze(publicView)');
  assert.throws(() => planner.analyze(view(0, 2, [], 0)), { name: 'RangeError' });
  assert.throws(() => planner.analyze(view(2, 2, [-2, -2, -2, -2], 5)), { name: 'RangeError' });
  assert.throws(() => planner.analyze(view(2, 1, [-2, 9], 0)), { name: 'RangeError' });
});

test('analysis collections are immutable and probabilities are query-only', () => {
  assert.equal(typeof planner?.analyze, 'function', 'planner exposes analyze(publicView)');
  const analysis = planner.analyze(view(3, 2, [0, -2, -2, -2, -2, -2], 1));

  assert.equal(Object.isFrozen(analysis), true);
  assert.equal(Object.isFrozen(analysis.hiddenCells), true);
  assert.equal(Object.isFrozen(analysis.frontierCells), true);
  assert.equal(Object.isFrozen(analysis.freeCells), true);
  assert.equal('probabilities' in analysis, false);
  assert.equal(analysis.mineProbabilityAt(0, 0), undefined);
});

test('search-limit fallback is complete but never claims certainty', () => {
  assert.equal(typeof planner?.analyze, 'function', 'planner exposes analyze(publicView)');
  const board = view(3, 2, [0, -2, -2, -2, -2, -2], 1);
  const analysis = planner.analyze(board, { maxSearchNodes: 0 });

  assert.equal(analysis.quality, 'approximate');
  assert.deepEqual(Array.from(analysis.certainMines), []);
  assert.deepEqual(Array.from(analysis.certainSafes), []);
  assert.equal(analysis.hiddenCells.length, 5);
  for (const cell of analysis.hiddenCells) {
    assert.equal(analysis.mineProbabilityAt(cell % board.width, Math.floor(cell / board.width)), 0.2);
  }
});
