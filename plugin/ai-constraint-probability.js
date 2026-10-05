"use strict";

(() => {
// Constraint-probability AI. Uses only the public makeDecision(view) contract.
function makeDecision(view) {
  const width = view.width;
  const height = view.height;
  const total = width * height;
  const hidden = [];
  const hiddenSet = new Set();
  const values = new Int8Array(total);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const value = view.cellAt(x, y);
      values[i] = value;
      if (value === -2) {
        hidden.push(i);
        hiddenSet.add(i);
      }
    }
  }
  if (hidden.length === 0) return null;
  const interiorHidden = hidden.filter(cell => {
    const x = cell % width;
    const y = Math.floor(cell / width);
    return x > 0 && x < width - 1 && y > 0 && y < height - 1;
  });

  const remain = Math.max(0, Math.min(hidden.length, Number(view.remainMines) || 0));
  const constraints = [];
  const frontier = new Set();
  let inconsistent = false;

  for (let i = 0; i < total; i++) {
    if (values[i] < 0) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    const unknown = [];
    let need = values[i];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (values[neighbor] === -1) need--;
        else if (values[neighbor] === -2) unknown.push(neighbor);
      }
    }
    if (unknown.length === 0) {
      if (need !== 0) inconsistent = true;
      continue;
    }
    if (need < 0 || need > unknown.length) inconsistent = true;
    constraints.push({ need, cells: unknown });
    for (const cell of unknown) frontier.add(cell);
  }

  const probabilities = inconsistent
    ? fallbackProbabilities(hidden, remain, constraints)
    : exactProbabilities(hidden, frontier, constraints, remain);
  const certainEdgeHidden = interiorHidden.length ? hidden.filter(cell => {
    const x = cell % width;
    const y = Math.floor(cell / width);
    const probability = probabilities.get(cell) ?? remain / hidden.length;
    return (x === 0 || y === 0 || x === width - 1 || y === height - 1) && probability >= 1 - 1e-12;
  }) : [];
  const openCandidates = interiorHidden.length ? [...interiorHidden, ...certainEdgeHidden] : hidden;

  let bestCell = -1;
  let bestMineProbability = -Infinity;
  let bestClueNeighbors = -1;
  let bestHiddenNeighbors = -1;
  let bestCenterDistance = Infinity;
  for (const cell of openCandidates) {
    const mineProbability = probabilities.get(cell) ?? remain / hidden.length;
    const clueNeighbors = countClueNeighbors(cell, width, height, values);
    const hiddenNeighbors = countHiddenNeighbors(cell, width, height, hiddenSet);
    const centerDistance = centerDistanceSquared(cell, width, height);
    const equalRisk = Math.abs(mineProbability - bestMineProbability) <= 1e-12;
    const betterTieBreak = clueNeighbors > bestClueNeighbors ||
      (clueNeighbors === bestClueNeighbors && hiddenNeighbors > bestHiddenNeighbors) ||
      (clueNeighbors === bestClueNeighbors && hiddenNeighbors === bestHiddenNeighbors &&
        centerDistance < bestCenterDistance);
    if (mineProbability > bestMineProbability + 1e-12 || (equalRisk && betterTieBreak)) {
      bestCell = cell;
      bestMineProbability = mineProbability;
      bestClueNeighbors = clueNeighbors;
      bestHiddenNeighbors = hiddenNeighbors;
      bestCenterDistance = centerDistance;
    }
  }

  if (view.canBomb && view.bombs > 0) {
    const candidate = bestBomb(view, probabilities, hiddenSet, bestMineProbability);
    const winNeed = Math.floor(view.mineCount / 2) + 1;
    const reachesWinLine = candidate && view.score + candidate.expectedMines >= winNeed;
    const conserveLastBomb = view.bombs === 1;
    if (candidate && (reachesWinLine || (!conserveLastBomb && candidate.expectedMines >= candidate.threshold))) {
      return candidate.action;
    }
  }
  return { type: 'open', x: bestCell % width, y: Math.floor(bestCell / width) };
}

function countHiddenNeighbors(cell, width, height, hiddenSet) {
  const x = cell % width;
  const y = Math.floor(cell / width);
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && hiddenSet.has(ny * width + nx)) count++;
    }
  }
  return count;
}

function centerDistanceSquared(cell, width, height) {
  const x = cell % width;
  const y = Math.floor(cell / width);
  const dx = x - (width - 1) / 2;
  const dy = y - (height - 1) / 2;
  return dx * dx + dy * dy;
}

function countClueNeighbors(cell, width, height, values) {
  const x = cell % width;
  const y = Math.floor(cell / width);
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const value = values[ny * width + nx];
      if (value >= 0 && value <= 8) count++;
    }
  }
  return count;
}

function exactProbabilities(hidden, frontier, constraints, remain) {
  const result = new Map();
  if (constraints.length === 0) {
    const risk = remain / hidden.length;
    for (const cell of hidden) result.set(cell, risk);
    return result;
  }

  const parent = new Map();
  for (const cell of frontier) parent.set(cell, cell);
  const find = cell => {
    let root = cell;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(cell) !== cell) {
      const next = parent.get(cell);
      parent.set(cell, root);
      cell = next;
    }
    return root;
  };
  for (const constraint of constraints) {
    for (let i = 1; i < constraint.cells.length; i++) {
      const a = find(constraint.cells[0]);
      const b = find(constraint.cells[i]);
      if (a !== b) parent.set(a, b);
    }
  }

  const groups = new Map();
  for (const cell of frontier) {
    const root = find(cell);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(cell);
  }
  const clusters = [];
  for (const cells of groups.values()) {
    const membership = new Set(cells);
    const localConstraints = constraints
      .filter(c => membership.has(c.cells[0]))
      .map(c => ({ need: c.need, cells: c.cells }));
    const solved = enumerateCluster(cells, localConstraints);
    if (solved.capped || solved.solutions === 0) {
      return fallbackProbabilities(hidden, remain, constraints);
    }
    clusters.push({ cells, ...solved });
  }

  const freeCells = hidden.filter(cell => !frontier.has(cell));
  const freeLogWays = logBinomialRow(freeCells.length);
  const logHistograms = clusters.map(cluster =>
    Float64Array.from(cluster.hist, count => count > 0 ? Math.log(count) : -Infinity));
  const prefix = [new Float64Array([0])];
  for (const histogram of logHistograms) {
    prefix.push(logConvolve(prefix[prefix.length - 1], histogram));
  }
  const suffix = new Array(clusters.length + 1);
  suffix[clusters.length] = freeLogWays;
  for (let i = clusters.length - 1; i >= 0; i--) {
    suffix[i] = logConvolve(logHistograms[i], suffix[i + 1]);
  }
  const allWays = suffix[0];
  const denominator = allWays[remain];
  if (denominator === undefined || denominator === -Infinity) {
    return fallbackProbabilities(hidden, remain, constraints);
  }

  if (freeCells.length > 0) {
    const terms = [];
    for (let clusterMines = 0; clusterMines < prefix[clusters.length].length; clusterMines++) {
      const freeMines = remain - clusterMines;
      if (freeMines <= 0 || freeMines > freeCells.length) continue;
      const logWays = prefix[clusters.length][clusterMines];
      const logChoose = freeLogWays[freeMines];
      if (logWays !== -Infinity && logChoose !== -Infinity) {
        terms.push(logWays + logChoose + Math.log(freeMines / freeCells.length));
      }
    }
    const risk = Math.exp(logSumExp(terms) - denominator);
    for (const cell of freeCells) result.set(cell, risk);
  }

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    const outsideWays = logConvolve(prefix[ci], suffix[ci + 1]);
    for (let cellIndex = 0; cellIndex < cluster.cells.length; cellIndex++) {
      const terms = [];
      for (let clusterMines = 0; clusterMines < cluster.strat[cellIndex].length; clusterMines++) {
        const assignments = cluster.strat[cellIndex][clusterMines];
        const outsideMines = remain - clusterMines;
        if (assignments === 0 || outsideMines < 0 || outsideMines >= outsideWays.length) continue;
        const outside = outsideWays[outsideMines];
        if (outside !== -Infinity) terms.push(Math.log(assignments) + outside);
      }
      result.set(cluster.cells[cellIndex], terms.length ? Math.exp(logSumExp(terms) - denominator) : 0);
    }
  }
  return result;
}

function enumerateCluster(cells, constraints) {
  const localIndex = new Map(cells.map((cell, index) => [cell, index]));
  const localConstraints = constraints.map(constraint => ({
    need: constraint.need,
    cells: constraint.cells.map(cell => localIndex.get(cell)),
  }));
  const membership = Array.from({ length: cells.length }, () => []);
  for (let ci = 0; ci < localConstraints.length; ci++) {
    for (const index of localConstraints[ci].cells) membership[index].push(ci);
  }
  const order = cells.map((_, index) => index).sort((a, b) => membership[b].length - membership[a].length);
  const remaining = localConstraints.map(constraint => constraint.cells.length);
  const mines = localConstraints.map(() => 0);
  const assignment = new Uint8Array(cells.length);
  const hist = new Float64Array(cells.length + 1);
  const strat = Array.from({ length: cells.length }, () => new Float64Array(cells.length + 1));
  const nodeLimit = 250000;
  let nodes = 0;
  let solutions = 0;
  let capped = false;

  function visit(depth, mineCount) {
    if (++nodes > nodeLimit) {
      capped = true;
      return;
    }
    if (depth === order.length) {
      for (let ci = 0; ci < localConstraints.length; ci++) {
        if (mines[ci] !== localConstraints[ci].need) return;
      }
      solutions++;
      hist[mineCount]++;
      for (let i = 0; i < assignment.length; i++) {
        if (assignment[i]) strat[i][mineCount]++;
      }
      return;
    }

    const index = order[depth];
    for (let value = 0; value <= 1; value++) {
      assignment[index] = value;
      let valid = true;
      for (const ci of membership[index]) {
        remaining[ci]--;
        mines[ci] += value;
        if (mines[ci] > localConstraints[ci].need ||
            mines[ci] + remaining[ci] < localConstraints[ci].need) valid = false;
      }
      if (valid) visit(depth + 1, mineCount + value);
      for (const ci of membership[index]) {
        remaining[ci]++;
        mines[ci] -= value;
      }
      if (capped) return;
    }
  }

  visit(0, 0);
  return { solutions, hist, strat, capped };
}

function fallbackProbabilities(hidden, remain, constraints) {
  const result = new Map();
  const base = remain / Math.max(1, hidden.length);
  const estimates = new Map(hidden.map(cell => [cell, []]));
  for (const constraint of constraints) {
    if (!constraint.cells.length) continue;
    const estimate = Math.max(0, Math.min(1, constraint.need / constraint.cells.length));
    for (const cell of constraint.cells) estimates.get(cell)?.push(estimate);
  }
  let sum = 0;
  for (const cell of hidden) {
    const values = estimates.get(cell);
    const risk = values?.length ? values.reduce((a, b) => a + b, 0) / values.length : base;
    result.set(cell, risk);
    sum += risk;
  }
  const correction = (remain - sum) / Math.max(1, hidden.length);
  for (const cell of hidden) result.set(cell, Math.max(0, Math.min(1, result.get(cell) + correction)));
  return result;
}

function logBinomialRow(n) {
  const logFactorial = new Float64Array(n + 1);
  for (let i = 2; i <= n; i++) logFactorial[i] = logFactorial[i - 1] + Math.log(i);
  const row = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    row[k] = logFactorial[n] - logFactorial[k] - logFactorial[n - k];
  }
  return row;
}

function logConvolve(a, b) {
  const result = new Float64Array(a.length + b.length - 1).fill(-Infinity);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === -Infinity) continue;
    for (let j = 0; j < b.length; j++) {
      if (b[j] === -Infinity) continue;
      result[i + j] = logAdd(result[i + j], a[i] + b[j]);
    }
  }
  return result;
}

function logAdd(a, b) {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const high = Math.max(a, b);
  return high + Math.log(Math.exp(a - high) + Math.exp(b - high));
}

function logSumExp(values) {
  return values.reduce(logAdd, -Infinity);
}

function bestBomb(view, probabilities, hidden, bestOpenMineProbability) {
  const width = view.width;
  const height = view.height;
  const radiusX = Math.max(0, Math.floor(view.bombRadiusH || 0));
  const radiusY = Math.max(0, Math.floor(view.bombRadiusV || 0));
  let best = null;
  let bestYield = -1;
  let bestHidden = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let expectedMines = 0;
      let hiddenCount = 0;
      for (let dy = -radiusY; dy <= radiusY; dy++) {
        for (let dx = -radiusX; dx <= radiusX; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const cell = ny * width + nx;
          if (!hidden.has(cell)) continue;
          hiddenCount++;
          expectedMines += probabilities.get(cell) ?? view.remainMines / Math.max(1, hidden.size);
        }
      }
      if (expectedMines > bestYield + 1e-12 ||
          (Math.abs(expectedMines - bestYield) <= 1e-12 && hiddenCount > bestHidden)) {
        best = { type: 'bomb', x, y };
        bestYield = expectedMines;
        bestHidden = hiddenCount;
      }
    }
  }

  const threshold = Math.max(1, bestOpenMineProbability + 0.5);
  return best && bestHidden > 0 ? { action: best, expectedMines: bestYield, hiddenCount: bestHidden, threshold } : null;
}

window.MineAIPlugins.register('constraint-probability', makeDecision);
})();
