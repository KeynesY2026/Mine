"use strict";

(() => {
  const { clamp, neighbours, eachNei, randInt } = window.MineCore;
  const DEFAULT_MAX_SEARCH_NODES = 250000;

  function analyze(view, options = {}) {
    const state = readPublicState(view);
    const maxSearchNodes = options.maxSearchNodes ?? DEFAULT_MAX_SEARCH_NODES;
    if (!Number.isSafeInteger(maxSearchNodes) || maxSearchNodes < 0) {
      throw new RangeError('maxSearchNodes must be a non-negative safe integer');
    }
    const { width, height, total, cells, hidden, remainMines } = state;
    const frontierSet = new Set();
    const constraints = [];
    let inconsistent = false;
    const nb = neighbours(width, height);

    for (let i = 0; i < total; i++) {
      const clue = cells[i];
      if (clue < 0) continue;
      const adjacent = [];
      let need = clue;
      eachNei(nb, i, j => {
        if (cells[j] === -1) need--;
        else if (cells[j] === -2) adjacent.push(j);
      });
      if (adjacent.length === 0) {
        if (need !== 0) inconsistent = true;
        continue;
      }
      if (need < 0 || need > adjacent.length) inconsistent = true;
      for (const cell of adjacent) frontierSet.add(cell);
      constraints.push({ need, cells: adjacent });
    }

    const frontier = [...frontierSet].sort((a, b) => a - b);
    const free = hidden.filter(cell => !frontierSet.has(cell));
    if (inconsistent) return approximate(state, frontier, free, 'inconsistent public clues');
    if (hidden.length === 0) return exactAnalysis(state, frontier, free, new Map(), [], []);
    if (constraints.length === 0) {
      const p = remainMines / hidden.length;
      const probabilities = new Map(hidden.map(cell => [cell, p]));
      const certainMines = p === 1 ? hidden : [];
      const certainSafes = p === 0 ? hidden : [];
      return createAnalysis(state, frontier, free, probabilities, certainMines, certainSafes, 'exact', undefined, 0);
    }
    if (maxSearchNodes === 0) return approximate(state, frontier, free, 'search limit exceeded');

    const parent = new Map(frontier.map(cell => [cell, cell]));
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
        const left = find(constraint.cells[0]);
        const right = find(constraint.cells[i]);
        if (left !== right) parent.set(left, right);
      }
    }

    const groups = new Map();
    for (const cell of frontier) {
      const root = find(cell);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(cell);
    }
    const clusters = [...groups.values()].map(cellsInCluster => {
      const members = new Set(cellsInCluster);
      const localConstraints = constraints.filter(c => members.has(c.cells[0]));
      return { cells: cellsInCluster, constraints: localConstraints };
    });

    const budget = { nodes: 0, limit: maxSearchNodes, exceeded: false };
    for (const cluster of clusters) {
      cluster.solved = enumerateCluster(cluster.cells, cluster.constraints, budget);
      if (budget.exceeded) return approximate(state, frontier, free, 'search limit exceeded');
      if (cluster.solved.solutions === 0n) return approximate(state, frontier, free, 'no satisfying assignments');
    }

    const minFrontierMines = clusters.reduce((sum, cluster) => {
      const minimum = cluster.solved.hist.findIndex(assignments => assignments > 0n);
      return sum + minimum;
    }, 0);
    const prefix = [ [1n] ];
    for (const cluster of clusters) prefix.push(convolve(prefix[prefix.length - 1], cluster.solved.hist));
    const freeWays = binomialRow(free.length);
    const denominator = dotCompatible(prefix[clusters.length], freeWays, remainMines);
    if (denominator === 0n) return approximate(state, frontier, free, 'remaining mine count has no satisfying assignments', minFrontierMines);

    const probabilities = new Map();
    const certainMines = [];
    const certainSafes = [];
    const setProbability = (cell, numerator) => {
      const probability = ratio(numerator, denominator);
      probabilities.set(cell, probability);
      if (numerator === denominator) certainMines.push(cell);
      else if (numerator === 0n) certainSafes.push(cell);
    };

    if (free.length > 0) {
      const freeCellWays = binomialRow(free.length - 1);
      let numerator = 0n;
      for (let otherMines = 0; otherMines < prefix[clusters.length].length; otherMines++) {
        const otherWays = freeCellWays[remainMines - otherMines - 1];
        if (otherWays !== undefined) numerator += prefix[clusters.length][otherMines] * otherWays;
      }
      const p = ratio(numerator, denominator);
      for (const cell of free) {
        probabilities.set(cell, p);
        if (numerator === denominator) certainMines.push(cell);
        else if (numerator === 0n) certainSafes.push(cell);
      }
    }

    const suffix = new Array(clusters.length + 1);
    suffix[clusters.length] = freeWays;
    for (let i = clusters.length - 1; i >= 0; i--) {
      suffix[i] = convolve(clusters[i].solved.hist, suffix[i + 1]);
    }
    for (let ci = 0; ci < clusters.length; ci++) {
      const outside = convolve(prefix[ci], suffix[ci + 1]);
      const cluster = clusters[ci];
      for (let cellIndex = 0; cellIndex < cluster.cells.length; cellIndex++) {
        let numerator = 0n;
        const strata = cluster.solved.strata[cellIndex];
        for (let minesInCluster = 0; minesInCluster < strata.length; minesInCluster++) {
          const assignments = strata[minesInCluster];
          const outsideWays = outside[remainMines - minesInCluster];
          if (assignments && outsideWays !== undefined) numerator += assignments * outsideWays;
        }
        setProbability(cluster.cells[cellIndex], numerator);
      }
    }

    if (probabilities.size !== hidden.length) return approximate(state, frontier, free, 'incomplete probability table', minFrontierMines);
    return createAnalysis(state, frontier, free, probabilities, certainMines, certainSafes, 'exact', undefined, minFrontierMines);
  }

  function readPublicState(view) {
    if (!view || !Number.isSafeInteger(view.width) || !Number.isSafeInteger(view.height) ||
        view.width < 1 || view.height < 1 || view.width > 35 || view.height > 35 ||
        typeof view.cellAt !== 'function') {
      throw new RangeError('invalid public board dimensions or cell reader');
    }
    const width = view.width;
    const height = view.height;
    const total = width * height;
    const mineCount = view.mineCount;
    const remainMines = view.remainMines;
    if (!Number.isSafeInteger(mineCount) || mineCount < 0 || mineCount > total ||
        !Number.isSafeInteger(remainMines) || remainMines < 0 || remainMines > total) {
      throw new RangeError('invalid public mine totals');
    }
    const cells = new Int8Array(total);
    const hidden = [];
    let revealedMines = 0;
    for (let i = 0; i < total; i++) {
      let value;
      try { value = view.cellAt(i % width, Math.floor(i / width)); }
      catch { throw new RangeError('public cell reader failed'); }
      if (!Number.isInteger(value) || !(value === -2 || value === -1 || (value >= 0 && value <= 8))) {
        throw new RangeError('invalid public cell value');
      }
      cells[i] = value;
      if (value === -2) hidden.push(i);
      else if (value === -1) revealedMines++;
    }
    if (remainMines > hidden.length || remainMines + revealedMines !== mineCount) {
      throw new RangeError('public mine totals do not match the visible board');
    }
    return { width, height, total, cells, hidden, mineCount, remainMines };
  }

  function enumerateCluster(cells, constraints, budget) {
    const localIndex = new Map(cells.map((cell, index) => [cell, index]));
    const localConstraints = constraints.map(c => ({
      need: c.need,
      cells: c.cells.map(cell => localIndex.get(cell)),
    }));
    const membership = Array.from({ length: cells.length }, () => []);
    for (let ci = 0; ci < localConstraints.length; ci++) {
      for (const index of localConstraints[ci].cells) membership[index].push(ci);
    }
    const order = cells.map((_, index) => index)
      .sort((a, b) => membership[b].length - membership[a].length);
    const assigned = localConstraints.map(() => 0);
    const mines = localConstraints.map(() => 0);
    const assignment = new Uint8Array(cells.length);
    const hist = Array(cells.length + 1).fill(0n);
    const strata = Array.from({ length: cells.length }, () => Array(cells.length + 1).fill(0n));
    let solutions = 0n;

    function visit(depth, mineCount) {
      if (budget.nodes >= budget.limit) { budget.exceeded = true; return; }
      budget.nodes++;
      if (depth === order.length) {
        for (let ci = 0; ci < localConstraints.length; ci++) {
          if (mines[ci] !== localConstraints[ci].need) return;
        }
        solutions++;
        hist[mineCount]++;
        for (let i = 0; i < assignment.length; i++) if (assignment[i]) strata[i][mineCount]++;
        return;
      }

      const index = order[depth];
      for (let value = 0; value <= 1; value++) {
        assignment[index] = value;
        let valid = true;
        for (const ci of membership[index]) {
          assigned[ci]++;
          mines[ci] += value;
          const stillUnassigned = localConstraints[ci].cells.length - assigned[ci];
          if (mines[ci] > localConstraints[ci].need ||
              mines[ci] + stillUnassigned < localConstraints[ci].need) valid = false;
        }
        if (valid) visit(depth + 1, mineCount + value);
        for (const ci of membership[index]) {
          assigned[ci]--;
          mines[ci] -= value;
        }
        if (budget.exceeded) return;
      }
    }

    visit(0, 0);
    return { solutions, hist, strata };
  }

  function binomialRow(n) {
    const row = Array(n + 1).fill(0n);
    row[0] = 1n;
    for (let k = 1; k <= n; k++) row[k] = row[k - 1] * BigInt(n - k + 1) / BigInt(k);
    return row;
  }

  function convolve(left, right) {
    const result = Array(left.length + right.length - 1).fill(0n);
    for (let i = 0; i < left.length; i++) {
      if (left[i] === 0n) continue;
      for (let j = 0; j < right.length; j++) {
        if (right[j] !== 0n) result[i + j] += left[i] * right[j];
      }
    }
    return result;
  }

  function dotCompatible(left, right, totalMines) {
    let sum = 0n;
    for (let i = 0; i < left.length; i++) {
      const other = right[totalMines - i];
      if (other !== undefined && left[i] !== 0n) sum += left[i] * other;
    }
    return sum;
  }

  function ratio(numerator, denominator) {
    if (numerator === 0n) return 0;
    if (numerator === denominator) return 1;
    const left = numerator.toString();
    const right = denominator.toString();
    const leftHead = Number(left.slice(0, 16));
    const rightHead = Number(right.slice(0, 16));
    const exponent = left.length - right.length;
    return Math.max(0, Math.min(1, (leftHead / rightHead) * (10 ** exponent)));
  }

  function approximate(state, frontier, free, error, minFrontierMines) {
    const risk = state.hidden.length ? state.remainMines / state.hidden.length : 0;
    const probabilities = new Map(state.hidden.map(cell => [cell, risk]));
    return createAnalysis(state, frontier, free, probabilities, [], [], 'approximate', error, minFrontierMines);
  }

  function exactAnalysis(state, frontier, free, probabilities, certainMines, certainSafes) {
    return createAnalysis(state, frontier, free, probabilities, certainMines, certainSafes, 'exact');
  }

  function createAnalysis(state, frontier, free, probabilities, certainMines, certainSafes, quality, error, minFrontierMines) {
    const hidden = Object.freeze(state.hidden.slice());
    const frozenFrontier = Object.freeze(frontier.slice());
    const frozenFree = Object.freeze(free.slice());
    const frozenCertainMines = Object.freeze(certainMines.slice().sort((a, b) => a - b));
    const frozenCertainSafes = Object.freeze(certainSafes.slice().sort((a, b) => a - b));
    const freeMineProbability = frozenFree.length === 0 ? null
      : Number.isInteger(minFrontierMines)
        ? clamp((state.remainMines - minFrontierMines) / frozenFree.length, 0, 1)
        : probabilities.get(frozenFree[0]);
    const bombCenters = [];
    for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
      let expectedMines = 0;
      let hiddenCount = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
        const cell = ny * state.width + nx;
        if (state.cells[cell] !== -2) continue;
        hiddenCount++;
        expectedMines += probabilities.get(cell) ?? 0;
      }
      if (hiddenCount > 0 && state.cells[y * state.width + x] === -2) {
        bombCenters.push(Object.freeze({ x, y, expectedMines, hiddenCount }));
      }
    }
    const analysis = {
      quality,
      hiddenCells: hidden,
      frontierCells: frozenFrontier,
      freeCells: frozenFree,
      freeMineProbability,
      bombCenters: Object.freeze(bombCenters),
      certainMines: frozenCertainMines,
      certainSafes: frozenCertainSafes,
      mineProbabilityAt(x, y) {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.width || y >= state.height) return undefined;
        return probabilities.get(y * state.width + x);
      },
    };
    if (error) analysis.error = error;
    return Object.freeze(analysis);
  }

  function chooseFallback(view, analysis, randomIndex = randInt) {
    if (!analysis || analysis.hiddenCells.length === 0) return null;
    const choose = cells => {
      if (!cells.length) return -1;
      const selected = Number(randomIndex(cells.length));
      return cells[Number.isInteger(selected) && selected >= 0 && selected < cells.length ? selected : 0];
    };
    if (analysis.quality === 'exact' && analysis.certainMines.length) {
      const cell = choose(analysis.certainMines);
      return { type: 'open', x: cell % view.width, y: Math.floor(cell / view.width) };
    }
    const frontier = Array.from(analysis.frontierCells);
    const free = Array.from(analysis.freeCells);
    let selected = -1;
    if (frontier.length && free.length) {
      let highest = -Infinity;
      let tied = [];
      for (const cell of frontier) {
        const probability = analysis.mineProbabilityAt(cell % view.width, Math.floor(cell / view.width));
        if (probability > highest) { highest = probability; tied = [cell]; }
        else if (probability === highest) tied.push(cell);
      }
      selected = highest < analysis.freeMineProbability ? choose(free) : choose(tied);
    } else selected = choose(frontier.length ? frontier : free);
    if (selected < 0) return null;

    const winNeed = Math.floor(view.mineCount / 2) + 1;
    if (Math.abs(view.score - view.oppScore) <= 2 && winNeed - Math.max(view.score, view.oppScore) <= 3) {
      const local = analysis.hiddenCells.filter(cell => {
        const x = cell % view.width, y = Math.floor(cell / view.width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < view.width && ny < view.height && view.cellAt(nx, ny) === -1) return true;
        }
        return false;
      });
      if (local.length) {
        let lowest = Infinity;
        let tied = [];
        for (const cell of local) {
          const probability = analysis.mineProbabilityAt(cell % view.width, Math.floor(cell / view.width));
          if (probability < lowest) { lowest = probability; tied = [cell]; }
          else if (probability === lowest) tied.push(cell);
        }
        selected = choose(tied);
      }
    }
    return { type: 'open', x: selected % view.width, y: Math.floor(selected / view.width) };
  }

  window.MineAIPlanner = Object.freeze({ analyze, chooseFallback });
})();
