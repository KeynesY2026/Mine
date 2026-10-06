"use strict";

(() => {
const { randInt } = window.MineCore;

function probability(view, cell) {
  const value = view.analysis.mineProbabilityAt(cell % view.width, Math.floor(cell / view.width));
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function randomCell(cells) {
  if (!cells.length) return -1;
  return cells[randInt(cells.length)];
}

function highestRiskCell(view, cells) {
  let highest = -Infinity;
  let tied = [];
  for (const cell of cells) {
    const p = probability(view, cell);
    if (p === null) continue;
    if (p > highest) { highest = p; tied = [cell]; }
    else if (p === highest) tied.push(cell);
  }
  return { cell: randomCell(tied), probability: highest };
}

function lowestRiskCell(view, cells) {
  let lowest = Infinity;
  let tied = [];
  for (const cell of cells) {
    const p = probability(view, cell);
    if (p === null) continue;
    if (p < lowest) { lowest = p; tied = [cell]; }
    else if (p === lowest) tied.push(cell);
  }
  return randomCell(tied);
}

function isAdjacentToRevealedMine(view, cell) {
  const x = cell % view.width;
  const y = Math.floor(cell / view.width);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < view.width && ny < view.height && view.cellAt(nx, ny) === -1) return true;
  }
  return false;
}

function selectByExpectedMines(candidates) {
  let maximum = -Infinity;
  let tied = [];
  for (const candidate of candidates) {
    if (candidate.expectedMines > maximum) {
      maximum = candidate.expectedMines;
      tied = [candidate];
    } else if (candidate.expectedMines === maximum) tied.push(candidate);
  }
  return tied.length ? tied[randInt(tied.length)] : null;
}

function selectByEstimatedWinProbability(candidates, needed) {
  let maximum = -Infinity;
  let tied = [];
  for (const candidate of candidates) {
    const probabilities = candidate.estimatedHitCountProbabilities || [];
    let winProbability = 0;
    for (let hits = Math.max(0, needed); hits < probabilities.length; hits++) {
      winProbability += probabilities[hits];
    }
    if (winProbability > maximum) {
      maximum = winProbability;
      tied = [candidate];
    } else if (winProbability === maximum) tied.push(candidate);
  }
  return selectByExpectedMines(tied);
}

function chooseBomb(view) {
  if (!view.canBomb || view.bombs <= 0) return null;
  const candidates = (view.analysis.bombCenters || []).filter(candidate => candidate.hiddenCount > 0);
  if (!candidates.length) return null;

  let best;
  if (view.analysis.singlePossibleMineRegion) {
    const needed = Math.floor(view.mineCount / 2) + 1 - view.score;
    best = selectByEstimatedWinProbability(candidates, needed);
  } else {
    best = selectByExpectedMines(candidates);
    if (!best || best.expectedMines >= view.oppScore - view.score) return null;
  }
  return best ? { type: 'bomb', x: best.x, y: best.y } : null;
}

function makeDecision(view) {
  const analysis = view.analysis;
  if (!analysis || !Array.isArray(analysis.hiddenCells) || analysis.hiddenCells.length === 0) return null;
  const bomb = chooseBomb(view);
  if (bomb) return bomb;
  if (analysis.quality === 'exact' && analysis.certainMines.length) {
    const mine = randomCell(analysis.certainMines);
    return { type: 'open', x: mine % view.width, y: Math.floor(mine / view.width) };
  }

  const frontier = Array.from(analysis.frontierCells);
  const free = Array.from(analysis.freeCells);
  let selected = -1;
  if (frontier.length && free.length) {
    const bestFrontier = highestRiskCell(view, frontier);
    selected = bestFrontier.probability < analysis.freeMineProbability
      ? randomCell(free)
      : bestFrontier.cell;
  } else if (frontier.length) {
    selected = highestRiskCell(view, frontier).cell;
  } else {
    selected = randomCell(free);
  }
  if (selected < 0) return null;

  const winNeed = Math.floor(view.mineCount / 2) + 1;
  const closeScore = Math.abs(view.score - view.oppScore) <= 2;
  const closeToWin = winNeed - Math.max(view.score, view.oppScore) <= 3;
  if (closeScore && closeToWin) {
    const local = analysis.hiddenCells.filter(cell => isAdjacentToRevealedMine(view, cell));
    if (local.length) selected = lowestRiskCell(view, local);
  }

  if (probability(view, selected) === null) return null;
  return { type: 'open', x: selected % view.width, y: Math.floor(selected / view.width) };
}

window.MineAIPlugins.register('constraint-probability', makeDecision);
})();
