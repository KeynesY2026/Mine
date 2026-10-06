"use strict";
/* 雷暴 MineStorm — 中等 AI；决策顺序沿用原规则，概率来自共享公开分析。 */
(() => {
const { randInt } = window.MineCore;

function bestBombCenter(view) {
  const candidates = view.analysis?.bombCenters || [];
  let best = null;
  for (const candidate of candidates) {
    if (!candidate.hiddenCount) continue;
    if (!best || candidate.expectedMines > best.expectedMines) best = candidate;
  }
  return best ? { type: 'bomb', x: best.x, y: best.y } : null;
}

function strongDecide(view) {
  const analysis = view.analysis;
  if (!analysis) return null;
  const w = view.width, h = view.height;
  const hidden = [];
  let hasInteriorHidden = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (view.cellAt(x, y) !== -2) continue;
    const i = y * w + x;
    hidden.push(i);
    if (x > 0 && x < w - 1 && y > 0 && y < h - 1) hasInteriorHidden = true;
  }
  if (hidden.length === 0) return null;
  const certainMines = new Set(analysis.quality === 'exact' ? analysis.certainMines : []);
  const eligible = hidden.filter(i => {
    const x = i % w, y = Math.floor(i / w);
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    const p = analysis.mineProbabilityAt(x, y);
    return !hasInteriorHidden || !edge || (analysis.quality === 'exact' && certainMines.has(i));
  });

  // Preserve Medium's bomb timing and bomb-before-open order; target by shared expected yield.
  const bombWanted = view.canBomb && view.bombs > 0 && view.oppScore - view.score >= 5;
  if (bombWanted) {
    const bomb = bestBombCenter(view);
    if (bomb) return bomb;
  }

  let best = -1, bestProbability = -Infinity;
  for (const i of eligible) {
    const p = analysis.mineProbabilityAt(i % w, Math.floor(i / w));
    if (!Number.isFinite(p)) return null;
    if (p > bestProbability) { bestProbability = p; best = i; }
  }
  if (best >= 0) return { type: 'open', x: best % w, y: Math.floor(best / w) };

  const fallback = eligible.length ? eligible : hidden;
  const i = fallback[randInt(fallback.length)];
  return { type: 'open', x: i % w, y: Math.floor(i / w) };
}

window.MineCore.strongDecide = strongDecide;
})();
