"use strict";
/* 雷暴 MineStorm — 简单 AI；候选排序沿用原版规则，概率来自共享公开分析。 */
(() => {
const { neighbours, eachNei, randInt } = window.MineCore;

function wantBomb(view) {
  return !!view.canBomb && view.bombs > 0 && view.score < view.oppScore;
}

function bombCenterByAnalysis(view) {
  const candidates = view.analysis?.bombCenters;
  if (!candidates?.length) return null;
  let bestHidden = -1;
  let best = [];
  for (const candidate of candidates) {
    if (candidate.hiddenCount > bestHidden) {
      bestHidden = candidate.hiddenCount;
      best = [candidate];
    } else if (candidate.hiddenCount === bestHidden) best.push(candidate);
  }
  if (bestHidden <= 0) return null;
  const chosen = best[randInt(best.length)];
  return { type: 'bomb', x: chosen.x, y: chosen.y };
}

function weakDecide(view) {
  const analysis = view.analysis;
  if (!analysis) return null;
  const w = view.width, h = view.height, total = w * h;
  const nb = neighbours(w, h);
  const cells = new Int8Array(total); // 0 hidden,1 revealed mine,2+ revealed number
  const hidden = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const value = view.cellAt(x, y);
    const i = y * w + x;
    cells[i] = value === -2 ? 0 : value === -1 ? 1 : value + 2;
    if (value === -2) hidden.push(i);
  }
  if (hidden.length === 0) return null;

  const certainMines = new Set(analysis.quality === 'exact' ? analysis.certainMines : []);
  const values = new Float64Array(total).fill(-1);
  const besideRevealedMine = new Uint8Array(total);
  for (const i of hidden) {
    const probability = analysis.mineProbabilityAt(i % w, Math.floor(i / w));
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) return null;
    values[i] = certainMines.has(i) ? 100 : probability;
    eachNei(nb, i, j => { if (cells[j] === 1) besideRevealedMine[i] = 1; });
  }

  const interior = hidden.filter(i => {
    const x = i % w, y = Math.floor(i / w);
    return x > 0 && x < w - 1 && y > 0 && y < h - 1;
  });
  const openCandidates = interior.length ? interior : hidden;
  const randTie = i => randInt(besideRevealedMine[i] ? 2 : 3) === 0;
  for (const i of hidden) if (certainMines.has(i)) return { type: 'open', x: i % w, y: Math.floor(i / w) };

  // Keep Simple's original local-maximum, interior and tie-preference rules.
  let maxP = -1, nCell = -1, blockMax = -1, blockPos = -1;
  for (const i of openCandidates) {
    let isMax = true;
    const n = nb.NEICnt[i];
    for (let k = 0; k < n; k++) {
      const j = nb.NEI[i * 8 + k];
      if (cells[j] === 0 && values[j] >= values[i] && values[j] !== -1) { isMax = false; break; }
    }
    const value = values[i];
    if (isMax) {
      if (value > blockMax || (value === blockMax && value >= 0 && randTie(i))) { blockMax = value; blockPos = i; }
    } else if (value > maxP || (value === maxP && value >= 0 && randTie(i))) {
      maxP = value;
      nCell = i;
    }
  }
  if (blockMax > 0.5) nCell = blockPos;
  if (nCell < 0 || Math.max(maxP, blockMax) < 0) nCell = openCandidates[randInt(openCandidates.length)];

  if (wantBomb(view)) {
    const bomb = bombCenterByAnalysis(view);
    if (bomb) return bomb;
  }
  return { type: 'open', x: nCell % w, y: Math.floor(nCell / w) };
}

window.MineCore.weakDecide = weakDecide;
})();
