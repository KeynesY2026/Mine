"use strict";
/* 雷暴 MineStorm — 弱 AI（原版启发式）
   依赖: js/core.js 先行加载, window.MineCore 提供 neighbours/eachNei/randInt */
(() => {
const { neighbours, eachNei, randInt } = window.MineCore;

function wantBomb(view) {
  if (!view.canBomb) return false;
  const M = view.mineCount, total = view.width * view.height;
  const wish = Math.floor(M / total * (2 * view.bombRadiusH + 1) * (2 * view.bombRadiusV + 1));
  const win = Math.floor(M / 2) + 1;
  if (Math.abs(view.score - view.oppScore) > wish && Math.random() < 0.5) return true;
  if (win - view.score < wish) return true;
  if (win - view.oppScore < wish) return true;
  return false;
}
function bombCenterByHidden(view) {
  const w = view.width, h = view.height;
  const xs = 2 * view.bombRadiusH + 1, ys = 2 * view.bombRadiusV + 1;
  if (w < xs || h < ys) return null;
  let best = 0, bx = 0, by = 0;
  for (let sy = 0; sy <= h - ys; sy++) for (let sx = 0; sx <= w - xs; sx++) {
    let c = 0;
    for (let dy = 0; dy < ys; dy++) for (let dx = 0; dx < xs; dx++) {
      if (view.cellAt(sx + dx, sy + dy) === -2) c++;
    }
    if (c > best || (c === best && c > 0 && Math.random() < 0.5)) { best = c; bx = sx; by = sy; }
  }
  if (best <= 0) return null;
  return { type: 'bomb', x: bx + (xs >> 1), y: by + (ys >> 1) };
}
function weakDecide(view) {
  const w = view.width, h = view.height, total = w * h;
  const nb = neighbours(w, h);
  const cells = new Int8Array(total); // 0 hidden,1 mine,2 zero,3..9 number
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = view.cellAt(x, y);
    cells[y * w + x] = v === -2 ? 0 : v === -1 ? 1 : v + 2;
  }
  const visProb = new Float64Array(total).fill(-1);
  const confMine = new Uint8Array(total), confSafe = new Uint8Array(total);
  const biside = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (cells[i] !== 0) continue;
    eachNei(nb, i, j => { if (cells[j] === 1) biside[i] = 1; });
  }
  function hiddenValue(j) {
    if (confMine[j]) return 100;
    if (confSafe[j]) return 0;
    let t = 0, count = 0, hasMine = false;
    eachNei(nb, j, k => {
      if (cells[k] === 0) return;
      const p = visProb[k];
      if (p === 1.0) return 100;
      if (p === 0.0) return 0;
      if (p > 0) { if (p === 0.1) hasMine = true; else { t += (1 - t) * p; count++; } }
    });
    return (count === 0 && !hasMine) ? -1 : (t === 0 && hasMine ? 0.1 : t);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < total; i++) {
      if (cells[i] === 0) continue;
      const old = visProb[i];
      if (cells[i] <= 2) { visProb[i] = 0.1; }
      else {
        let nHide = 0, nRemain = cells[i] - 2, nMine = 0, nSafe = 0;
        eachNei(nb, i, j => {
          if (cells[j] === 1) { nRemain--; }
          else if (cells[j] === 0) {
            const p = hiddenValue(j);
            if (p === 100) { confMine[j] = 1; nMine++; }
            else if (p === 0) { confSafe[j] = 1; nSafe++; }
            else nHide++;
          }
        });
        visProb[i] = nHide === 0 ? ((nMine + nSafe) > 0 ? 1.0 : 0.0) : (nRemain - nMine) / nHide;
      }
      if (visProb[i] !== old) changed = true;
    }
  }
  const val = new Float64Array(total).fill(-1);
  for (let i = 0; i < total; i++) if (cells[i] === 0) val[i] = hiddenValue(i);
  const hidden = [];
  for (let i = 0; i < total; i++) if (cells[i] === 0) hidden.push(i);
  if (hidden.length === 0) return null;
  const randTie = i => Math.random() < 1 / (biside[i] ? 2 : 3);
  // 0. 确定的雷
  for (const i of hidden) if (val[i] === 100) return { type: 'open', x: i % w, y: (i / w) | 0 };
  // 1. 局部极大 + 最优
  let maxP = -1, nCell = -1, blockMax = -1, blockPos = -1;
  for (const i of hidden) {
    let isMax = true;
    {
      const n = nb.NEICnt[i];
      for (let k = 0; k < n; k++) {
        const j = nb.NEI[i * 8 + k];
        if (cells[j] === 0 && val[j] >= val[i] && val[j] !== -1) { isMax = false; break; }
      }
    }
    const v = val[i];
    if (isMax) { if (v > blockMax || (v === blockMax && v >= 0 && randTie(i))) { blockMax = v; blockPos = i; } }
    else { if (v > maxP || (v === maxP && v >= 0 && randTie(i))) { maxP = v; nCell = i; } }
  }
  if (blockMax > 0.5) nCell = blockPos;
  // 2. 无信息 → 随机
  if (nCell < 0 || Math.max(maxP, blockMax) < 0) nCell = hidden[randInt(hidden.length)];
  // 3. 炸弹策略
  if (wantBomb(view)) { const b = bombCenterByHidden(view); if (b) return b; }
  return { type: 'open', x: nCell % w, y: (nCell / w) | 0 };
}

window.MineCore.weakDecide = weakDecide;
})();
