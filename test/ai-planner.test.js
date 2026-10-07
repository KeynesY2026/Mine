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

function createAllocationObservedPlanner() {
  const observedContext = { window: {}, crypto: context.crypto };
  vm.runInNewContext(fs.readFileSync('js/core.js', 'utf8'), observedContext);
  vm.runInNewContext(`
    const nativePush = Array.prototype.push;
    const maskBigIntInputs = [];
    let retainedAssignments = 0;
    const nativeBigInt = BigInt;
    globalThis.BigInt = value => {
      nativePush.call(maskBigIntInputs, value);
      return nativeBigInt(value);
    };
    Array.prototype.push = function (...values) {
      for (const value of values) {
        if (value && typeof value === 'object' && Object.hasOwn(value, 'mineMask')) retainedAssignments++;
      }
      return nativePush.apply(this, values);
    };
    window.__resetAllocationCounts = () => {
      maskBigIntInputs.length = 0;
      retainedAssignments = 0;
    };
    window.__allocationCounts = () => ({ maskBigIntInputs: maskBigIntInputs.slice(), retainedAssignments });
  `, observedContext);
  vm.runInNewContext(plannerSource, observedContext);
  return { planner: observedContext.window.MineAIPlanner, window: observedContext.window };
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

function bruteForceHitCountDistribution(board, center) {
  const hidden = [];
  for (let i = 0; i < board.width * board.height; i++) {
    if (board.cellAt(i % board.width, Math.floor(i / board.width)) === -2) hidden.push(i);
  }
  assert.ok(hidden.length <= 20, 'oracle fixtures must have at most 20 hidden cells');
  const hiddenIndex = new Map(hidden.map((cell, bit) => [cell, bit]));
  const blast = hidden.filter(cell =>
    Math.abs(cell % board.width - center.x) <= 2 &&
    Math.abs(Math.floor(cell / board.width) - center.y) <= 2);
  const hitCounts = Array(blast.length + 1).fill(0);
  let validLayouts = 0;

  for (let mask = 0; mask < 2 ** hidden.length; mask++) {
    let totalMines = 0;
    for (let bit = 0; bit < hidden.length; bit++) totalMines += Math.floor(mask / (2 ** bit)) % 2;
    if (totalMines !== board.remainMines) continue;
    let satisfies = true;
    for (let y = 0; y < board.height && satisfies; y++) for (let x = 0; x < board.width && satisfies; x++) {
      const clue = board.cellAt(x, y);
      if (clue < 0) continue;
      let adjacentMines = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= board.width || ny >= board.height) continue;
        const value = board.cellAt(nx, ny);
        if (value === -1) adjacentMines++;
        else if (value === -2) {
          const bit = hiddenIndex.get(ny * board.width + nx);
          adjacentMines += Math.floor(mask / (2 ** bit)) % 2;
        }
      }
      if (adjacentMines !== clue) satisfies = false;
    }
    if (!satisfies) continue;

    let hits = 0;
    for (const cell of blast) {
      hits += Math.floor(mask / (2 ** hiddenIndex.get(cell))) % 2;
    }
    hitCounts[hits]++;
    validLayouts++;
  }

  assert.ok(validLayouts > 0, 'oracle fixture must have at least one satisfying layout');
  return hitCounts.map(count => count / validLayouts);
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

test('exact marginal probabilities preserve decimal scale and sum to remaining mines', () => {
  const cells = Array(49).fill(-2);
  cells[0] = 1;
  const board = view(7, 7, cells, 5);
  const analysis = planner.analyze(board);

  assert.equal(analysis.quality, 'exact');
  assert.ok(Math.abs(analysis.freeMineProbability - 4 / 45) < 1e-12);
  for (const cell of analysis.freeCells) {
    assert.ok(Math.abs(analysis.mineProbabilityAt(cell % board.width, Math.floor(cell / board.width)) - 4 / 45) < 1e-12);
  }
  const expectedTotal = analysis.hiddenCells.reduce((sum, cell) =>
    sum + analysis.mineProbabilityAt(cell % board.width, Math.floor(cell / board.width)), 0);
  assert.ok(Math.abs(expectedTotal - board.remainMines) < 1e-10);
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
  assert.equal(analysis.freeMineProbability, 0.5);
});

test('free-cell estimate clamps above one after subtracting frontier component minima', () => {
  const board = view(15, 1, [
    -2, 1, -2, 1, -2, -1, -1, -2, -2, -1, -2, 1, -2, 1, -2,
  ], 5, 8);
  const analysis = planner.analyze(board);

  assert.equal(analysis.quality, 'exact');
  assert.equal(analysis.freeMineProbability, 1);
});

test('globally inconsistent totals clamp the component-minimum estimate without claiming certainty', () => {
  const board = view(15, 1, [
    -2, 1, -2, 1, -2, -1, -1, -2, -2, -1, -2, 1, -2, 1, -2,
  ], 1, 4);
  const analysis = planner.analyze(board);

  assert.equal(analysis.quality, 'approximate');
  assert.equal(analysis.freeMineProbability, 0);
  assert.deepEqual(Array.from(analysis.certainMines), []);
  assert.deepEqual(Array.from(analysis.certainSafes), []);
});

test('public fallback follows frontier/free policy and returns only a legal hidden cell', () => {
  assert.equal(typeof planner?.chooseFallback, 'function', 'planner exposes a public-state fallback selector');
  const board = view(3, 2, [0, -2, -2, -2, -2, -2], 1);
  const analysis = planner.analyze(board);
  const action = planner.chooseFallback(board, analysis, () => 0);

  assert.deepEqual(JSON.parse(JSON.stringify(action)), { type: 'open', x: 2, y: 0 });
});

test('bomb coverage estimate greedily counts distinct hidden cells across remaining blasts', () => {
  const board = view(15, 1, Array(15).fill(-2), 15);
  const analysis = planner.analyze(board);

  assert.equal(analysis.bombCoverageRatio(0), 0);
  assert.equal(analysis.bombCoverageRatio(1), 1 / 3);
  assert.equal(analysis.bombCoverageRatio(2), 2 / 3);
  assert.equal(analysis.bombCoverageRatio(3), 1);
  assert.equal(analysis.bombCoverageRatio(100), 1);

  const overlappingBlasts = planner.analyze(view(7, 7, Array(49).fill(-2), 49));
  assert.equal(overlappingBlasts.bombCoverageRatio(2), 39 / 49);
});

test('analysis rates fixed 5x5 bomb centers with edge-clipped expected yields', () => {
  assert.equal(typeof planner?.analyze, 'function', 'planner exposes analyze(publicView)');
  const board = view(7, 7, Array(49).fill(-2), 49);
  const analysis = planner.analyze(board);
  const byCenter = new Map(analysis.bombCenters.map(candidate => [`${candidate.x},${candidate.y}`, candidate]));

  const project = ({ x, y, expectedMines, hiddenCount }) => ({ x, y, expectedMines, hiddenCount });
  assert.deepEqual(project(byCenter.get('0,0')), { x: 0, y: 0, expectedMines: 9, hiddenCount: 9 });
  assert.deepEqual(project(byCenter.get('3,3')), { x: 3, y: 3, expectedMines: 25, hiddenCount: 25 });
  assert.equal(analysis.bombCenters.length, 49);
});

test('bomb-center candidates exclude revealed centers while retaining their hidden blast yield', () => {
  const board = view(2, 1, [0, -2], 0);
  const analysis = planner.analyze(board);

  assert.deepEqual(Array.from(analysis.bombCenters, ({ x, y, expectedMines, hiddenCount }) => ({ x, y, expectedMines, hiddenCount })), [
    { x: 1, y: 0, expectedMines: 0, hiddenCount: 1 },
  ]);
});

test('ordinary exact analysis does not allocate joint-only masks or retain assignments', () => {
  const { planner: observedPlanner, window: observedWindow } = createAllocationObservedPlanner();
  const board = view(3, 1, [-2, 1, -2], 1);

  const ordinary = observedPlanner.analyze(board);
  const ordinaryAllocations = observedWindow.__allocationCounts();
  assert.equal(ordinary.quality, 'exact');
  assert.deepEqual(Array.from(ordinaryAllocations.maskBigIntInputs), []);
  assert.equal(ordinaryAllocations.retainedAssignments, 0);

  observedWindow.__resetAllocationCounts();
  const requested = observedPlanner.analyze(board, { includeJointHitDistributions: true });
  const requestedAllocations = observedWindow.__allocationCounts();
  const center = requested.bombCenters.find(candidate => candidate.x === 0 && candidate.y === 0);
  assert.deepEqual(Array.from(center.uniformHitCountProbabilities), [0, 1, 0]);
  assert.deepEqual(Array.from(requestedAllocations.maskBigIntInputs), [0, 1]);
  assert.equal(requestedAllocations.retainedAssignments, 2);
});

test('joint blast distributions are opt-in for normal public analysis', () => {
  const board = view(3, 1, [-2, 1, -2], 1);
  const ordinary = planner.analyze(board);
  const requested = planner.analyze(board, { includeJointHitDistributions: true });
  const ordinaryCenter = ordinary.bombCenters.find(candidate => candidate.x === 0 && candidate.y === 0);
  const requestedCenter = requested.bombCenters.find(candidate => candidate.x === 0 && candidate.y === 0);

  assert.equal(ordinaryCenter.uniformHitCountProbabilities, null);
  assert.deepEqual(Array.from(requestedCenter.uniformHitCountProbabilities), [0, 1, 0]);
});

test('joint blast distribution preserves clue correlation', () => {
  const board = view(3, 1, [-2, 1, -2], 1);
  const analysis = planner.analyze(board, { includeJointHitDistributions: true });
  const center = analysis.bombCenters.find(candidate => candidate.x === 0 && candidate.y === 0);

  assert.equal(analysis.quality, 'exact');
  assert.deepEqual(Array.from(center.uniformHitCountProbabilities), [0, 1, 0]);
  assert.equal(Object.isFrozen(center.uniformHitCountProbabilities), true);
  assert.equal(center.expectedMines, 1);
});

test('free-cell joint distribution uses the global mine total and clipped blast geometry', () => {
  const board = view(4, 3, Array(12).fill(-2), 4);
  const analysis = planner.analyze(board, { includeJointHitDistributions: true });

  assert.equal(analysis.quality, 'exact');
  const corner = analysis.bombCenters.find(candidate => candidate.x === 0 && candidate.y === 0);
  const fullBoard = analysis.bombCenters.find(candidate => candidate.x === 1 && candidate.y === 1);
  assert.equal(corner.hiddenCount, 9);
  assert.equal(corner.uniformHitCountProbabilities[0], 0);
  assert.ok(Math.abs(corner.uniformHitCountProbabilities[4] - 14 / 55) < 1e-12);
  assert.equal(fullBoard.hiddenCount, 12);
  assert.deepEqual(Array.from(fullBoard.uniformHitCountProbabilities), [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);

  for (const center of analysis.bombCenters) {
    const expected = bruteForceHitCountDistribution(board, center);
    const actual = Array.from(center.uniformHitCountProbabilities);
    assert.equal(actual.length, expected.length);
    for (let hits = 0; hits < expected.length; hits++) {
      assert.ok(Math.abs(actual[hits] - expected[hits]) < 1e-12, `center ${center.x},${center.y}, hits ${hits}`);
    }
    assert.ok(Math.abs(actual.reduce((sum, probability) => sum + probability, 0) - 1) < 1e-12);
    assert.ok(Math.abs(actual.reduce((sum, probability, hits) => sum + hits * probability, 0) - center.expectedMines) < 1e-10);
  }
});

test('component joint blast distributions match exhaustive public layouts', () => {
  const board = view(15, 1, [
    -2, 1, -2, 1, -2, -1, -1, -2, -2, -1, -2, 1, -2, 1, -2,
  ], 3, 6);
  const analysis = planner.analyze(board, { includeJointHitDistributions: true });

  assert.equal(analysis.quality, 'exact');
  for (const center of analysis.bombCenters) {
    const expected = bruteForceHitCountDistribution(board, center);
    const actual = Array.from(center.uniformHitCountProbabilities);
    assert.equal(actual.length, expected.length);
    for (let hits = 0; hits < expected.length; hits++) {
      assert.ok(Math.abs(actual[hits] - expected[hits]) < 1e-12, `center ${center.x},${center.y}, hits ${hits}`);
    }
  }
});

test('approximate bomb analysis does not expose exact joint hit probabilities', () => {
  const analysis = planner.analyze(view(3, 2, [0, -2, -2, -2, -2, -2], 1), {
    maxSearchNodes: 0,
    includeJointHitDistributions: true,
  });

  assert.equal(analysis.quality, 'approximate');
  assert.ok(analysis.bombCenters.every(center => center.uniformHitCountProbabilities === null));
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
