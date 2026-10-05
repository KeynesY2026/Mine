"use strict";
/* 雷暴 MineStorm — 强 AI 概率引擎
   依赖: js/core.js 先行加载, window.MineCore 提供 neighbours/eachNei/clamp/randInt */
(() => {
const { neighbours, eachNei, clamp, randInt } = window.MineCore;

const ENUM_CAP = 1 << 20;   // 每簇解数上限, 超过则退化为界先验
const LOGNEG = -Infinity;

function computeProbabilities(view) {
  const w = view.width, h = view.height, total = w * h;
  const nb = neighbours(w, h);
  const cells = new Int8Array(total); // 0 hidden,1 mine,2..9 number
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = view.cellAt(x, y);
    cells[y * w + x] = v === -2 ? 0 : v === -1 ? 1 : v + 2;
  }
  const R = clamp(view.remainMines, 0, total);
  const prob = new Map();

  // 阶段A: 收集数字格约束 {need, unknowns[]}
  const cons = [];
  const cellCons = new Map();
  for (let i = 0; i < total; i++) {
    if (cells[i] < 3) continue;
    let need = cells[i] - 2;
    const unknowns = [];
    eachNei(nb, i, j => { if (cells[j] === 1) need--; else if (cells[j] === 0) unknowns.push(j); });
    if (unknowns.length > 0) {
      const ci = cons.length;
      cons.push({ need, unknowns });
      for (const j of unknowns) {
        let a = cellCons.get(j); if (!a) { a = []; cellCons.set(j, a); }
        a.push(ci);
      }
    }
  }
  if (cons.length === 0) {
    const hidden = [];
    for (let i = 0; i < total; i++) if (cells[i] === 0) hidden.push(i);
    const p0 = R / Math.max(1, hidden.length);
    for (const i of hidden) prob.set(i, p0);
    return prob;
  }
  // 阶段B: 不动点传播
  const mark = new Int8Array(total); // 0 unknown 1 safe 2 mine
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of cons) {
      let un = 0, mine = 0;
      for (const j of c.unknowns) { const m = mark[j]; if (m === 0) un++; else if (m === 2) mine++; }
      const need = c.need - mine;
      if (un === 0) { if (need !== 0) return _fallbackUniform(prob, cells, R, total); }
      if (need === 0) { for (const j of c.unknowns) if (mark[j] === 0) { mark[j] = 1; changed = true; } }
      else if (need === un) { for (const j of c.unknowns) if (mark[j] === 0) { mark[j] = 2; changed = true; } }
    }
  }
  for (let i = 0; i < total; i++) if (cells[i] === 0 && mark[i]) prob.set(i, mark[i] === 2 ? 1 : 0);
  // 不动点推出的强制雷已计入 R, 全局条件化须用剩余雷数
  let Rrem = R;
  for (let i = 0; i < total; i++) if (cells[i] === 0 && mark[i] === 2) Rrem--;

  // 阶段C: 剩余未知格按共享约束分组 (并查集)
  const parent = new Int32Array(total).fill(-1);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < total; i++) if (cells[i] === 0 && mark[i] === 0) parent[i] = i;
  for (const c of cons) {
    const live = c.unknowns.filter(j => mark[j] === 0);
    for (let k = 1; k < live.length; k++) { const ra = find(live[0]), rb = find(live[k]); if (ra !== rb) parent[ra] = rb; }
  }
  const groups = new Map();
  // 只收有约束的隐藏格; 自由格(无 cellCons 条目)不参与分组, 否则 cellCons.get(j)=undefined 崩溃
  for (let i = 0; i < total; i++) if (cells[i] === 0 && mark[i] === 0 && parent[i] !== -1 && cellCons.has(i)) {
    const r = find(i); let g = groups.get(r); if (!g) { g = []; groups.set(r, g); } g.push(i);
  }
  let freeCells = 0;
  for (let i = 0; i < total; i++) if (cells[i] === 0 && mark[i] === 0 && !cellCons.has(i)) freeCells++;

  const clusters = [];
  for (const cells2 of groups.values()) {
    const ccons = [], seen = new Set();
    for (const j of cells2) for (const ci of cellCons.get(j)) {
      if (seen.has(ci)) continue; seen.add(ci);
      const c = cons[ci];
      let mine = 0; for (const k of c.unknowns) if (mark[k] === 2) mine++;
      ccons.push({ need: c.need - mine, cells: c.unknowns.filter(k => mark[k] === 0) });
    }
    const localIdx = new Map(); cells2.forEach((g, k) => localIdx.set(g, k));
    const lcons = ccons.map(c => ({ need: c.need, cells: c.cells.map(j => localIdx.get(j)) }));
    clusters.push({ globals: cells2, res: _enumerate(lcons, cells2.length) });
  }

  if (clusters.length === 0) {
    if (freeCells > 0) for (let i = 0; i < total; i++)
      if (cells[i] === 0 && mark[i] === 0 && !cellCons.has(i)) prob.set(i, Rrem / freeCells);
    return prob;
  }

  // 全局条件化
  const logClusters = clusters.map(cl => _clusterLogHist(cl, lconsOf(cl, cellCons, cons, mark)));
  const k = logClusters.length;
  const pre = [new Float64Array(1).fill(0)];
  for (let i = 0; i < k; i++) pre.push(_logConv(pre[i], logClusters[i]));
  const suf = new Array(k + 1);
  suf[k] = new Float64Array(1).fill(0);
  for (let i = k - 1; i >= 0; i--) suf[i] = _logConv(logClusters[i], suf[i + 1]);
  const f = freeCells;
  const logFact = new Float64Array(f + 1);
  for (let i = 2; i <= f; i++) logFact[i] = logFact[i - 1] + Math.log(i);
  const logC = (n, m) => (m < 0 || m > n) ? LOGNEG : logFact[n] - logFact[m] - logFact[n - m];
  const logW = new Float64Array(f + 1); // logW[t] = log C(f,t)
  for (let t = 0; t <= f; t++) logW[t] = logC(f, t);
  const H = pre[k]; // 全簇卷积
  const wmax = H.length;
  // logD = Σ_s H[s]·logC(f, R-s)
  const logDterms = [];
  for (let s = 0; s < wmax; s++) { const t = Rrem - s; if (t >= 0 && t <= f && H[s] > LOGNEG && logW[t] > LOGNEG) logDterms.push(H[s] + logW[t]); }
  const logD = _logSumExp(logDterms);
  if (logD === LOGNEG) {
    // 状态不一致 → 退化为簇内边际
    for (const cl of clusters) {
      const { perCell, solutions } = cl.res;
      if (solutions > 0) for (let li = 0; li < cl.globals.length; li++) prob.set(cl.globals[li], perCell[li] / solutions);
    }
    if (f > 0) for (let i = 0; i < total; i++)
      if (cells[i] === 0 && mark[i] === 0 && !cellCons.has(i)) prob.set(i, R / f);
    return prob;
  }
  // 自由格概率
  if (f > 0) {
    let m2 = LOGNEG, sum = 0;
    for (let s = 0; s < wmax; s++) {
      const t = Rrem - s;
      if (t <= 0 || t > f || H[s] === LOGNEG || logW[t] === LOGNEG) continue;
      const v = H[s] + logW[t] + Math.log(t) - Math.log(f);
      if (v > m2) m2 = v;
    }
    if (m2 !== LOGNEG) { for (let s = 0; s < wmax; s++) { const t = Rrem - s; if (t <= 0 || t > f || H[s] === LOGNEG || logW[t] === LOGNEG) continue; sum += Math.exp(H[s] + logW[t] + Math.log(t) - Math.log(f) - m2); } }
    const pf = m2 === LOGNEG ? 0 : Math.exp(m2 + Math.log(sum) - logD);
    for (let i = 0; i < total; i++) if (cells[i] === 0 && mark[i] === 0 && !cellCons.has(i)) prob.set(i, pf);
  }
  // 簇内每格概率: P(v) = Σ_m strat_i[v][m] · G_i[Rrem-m] / D
  // G_i = (其他簇卷积) ∗ (自由格二项式) — 修复: 原先误用 Wo[R-m]·C(f,R-m)
  for (let ci = 0; ci < k; ci++) {
    const cl = clusters[ci];
    const { strat, solutions } = cl.res;
    const n = cl.globals.length;
    const Wo = _logConv(pre[ci], suf[ci + 1]); // 其他簇卷积
    const G = _logConv(Wo, logW); // G[s] = log(本簇外恰好放 s 雷的方式数)
    for (let li = 0; li < n; li++) {
      let m2 = LOGNEG;
      for (let m = 0; m <= n; m++) {
        const c = strat[li][m];
        if (c === 0) continue;
        const t = Rrem - m;
        if (t < 0 || t >= G.length || G[t] === LOGNEG) continue;
        const v = Math.log(c) + G[t];
        if (v > m2) m2 = v;
      }
      if (m2 !== LOGNEG) {
        let s2 = 0;
        for (let m = 0; m <= n; m++) {
          const c = strat[li][m];
          if (c === 0) continue;
          const t = Rrem - m;
          if (t < 0 || t >= G.length || G[t] === LOGNEG) continue;
          s2 += Math.exp(Math.log(c) + G[t] - m2);
        }
        prob.set(cl.globals[li], Math.exp(m2 + Math.log(s2) - logD));
      } else {
        // 分子为零 = 无任何全局一致雷位包含 v → v 必安全 (0); 不可用簇内局部边际
        prob.set(cl.globals[li], 0);
      }
    }
  }
  return prob;
}

// 簇内约束 (局部索引)
function lconsOf(cl, cellCons, cons, mark) {
  const localIdx = new Map(); cl.globals.forEach((g, k2) => localIdx.set(g, k2));
  const out = [], seen = new Set();
  for (const j of cl.globals) for (const ci of cellCons.get(j)) {
    if (seen.has(ci)) continue; seen.add(ci);
    const c = cons[ci]; let mine = 0;
    for (const k of c.unknowns) if (mark[k] === 2) mine++;
    out.push({ need: c.need - mine, cells: c.unknowns.filter(k => mark[k] === 0).map(k => localIdx.get(k)) });
  }
  return out;
}
// 对数域卷积 (两个分布的独立组合)
function _logConv(a, b) {
  if (!a.length) return new Float64Array([0]);
  if (!b.length) return new Float64Array([0]);
  const out = new Float64Array(a.length + b.length - 1).fill(LOGNEG);
  for (let i = 0; i < a.length; i++) { if (a[i] === LOGNEG) continue;
    for (let j = 0; j < b.length; j++) { if (b[j] === LOGNEG) continue;
      const v = a[i] + b[j]; if (v > out[i + j]) out[i + j] = v; } }
  return out;
}
function _logSumExp(arr) {
  let m = LOGNEG;
  for (const v of arr) if (v > m) m = v;
  if (m === LOGNEG) return LOGNEG;
  let s = 0; for (const v of arr) if (v > LOGNEG) s += Math.exp(v - m);
  return m + Math.log(s);
}
function _clusterLogHist(cl, lcons) {
  const n = cl.globals.length;
  const { hist, solutions, capped } = cl.res;
  const logHist = new Float64Array(n + 1).fill(LOGNEG);
  if (solutions > 0 && !capped) { for (let m = 0; m <= n; m++) if (hist[m] > 0) logHist[m] = Math.log(hist[m]); }
  else {
    let lo = 0, hi = n;
    for (const c of lcons) { lo = Math.max(lo, c.need); hi = Math.min(hi, n - c.cells.length); }
    if (hi < lo) { lo = 0; hi = n; }
    const span = hi - lo + 1;
    for (let m = lo; m <= hi; m++) logHist[m] = Math.log(1 / span);
  }
  return logHist;
}
function _enumerate(lcons, n) {
  const cUnknown = lcons.map(c => c.cells.length);
  const cMine = lcons.map(() => 0);
  const cNeed = lcons.map(c => c.need);
  // 预计算每格属于哪些约束 (加速 mark/unmark)
  const cellToCons = Array.from({ length: n }, () => []);
  for (let ci = 0; ci < lcons.length; ci++) for (const li of lcons[ci].cells) cellToCons[li].push(ci);
  let solutions = 0;
  const perCell = new Float64Array(n);
  const hist = new Float64Array(n + 1);
  const strat = Array.from({ length: n }, () => new Float64Array(n + 1));
  let capped = false;
  const stack = [];
  function markMine(li) {
    let ok = true;
    for (const c of cellToCons[li]) { cUnknown[c]--; cMine[c]++; if (cMine[c] > cNeed[c]) ok = false; }
    return ok;
  }
  function unmarkMine(li) {
    for (const c of cellToCons[li]) { cUnknown[c]++; cMine[c]--; }
  }
  function allSatisfied() {
    for (let ci = 0; ci < lcons.length; ci++) if (cMine[ci] < cNeed[ci]) return false;
    return true;
  }
  function rec(start, remaining) {
    if (capped) return;
    if (allSatisfied()) {
      solutions++;
      const m = stack.length;
      hist[m]++;
      for (const li of stack) { perCell[li]++; strat[li][m]++; }
      if (solutions >= ENUM_CAP) capped = true;
      return;
    }
    if (remaining <= 0) return;
    // 剪枝: 任何约束 mine>need 或 (need-mine)>unknown 都无解
    for (let i = start; i < n; i++) {
      const ok = markMine(i);
      if (!ok) { unmarkMine(i); continue; }
      stack.push(i);
      let prune = false;
      for (let ci = 0; ci < lcons.length; ci++) {
        if (cMine[ci] > cNeed[ci] || cNeed[ci] - cMine[ci] > cUnknown[ci]) { prune = true; break; }
      }
      if (!prune) rec(i + 1, remaining - 1);
      stack.pop();
      unmarkMine(i);
      if (capped) return;
    }
  }
  rec(0, n);
  return { solutions, perCell, hist, strat, capped };
}
function _fallbackUniform(prob, cells, R, total) {
  prob.clear();
  let hidden = 0; for (let i = 0; i < total; i++) if (cells[i] === 0) hidden++;
  if (hidden > 0) for (let i = 0; i < total; i++) if (cells[i] === 0) prob.set(i, R / hidden);
  return prob;
}
function strongDecide(view) {
  const prob = computeProbabilities(view);
  const w = view.width, h = view.height, total = w * h;
  const bw = view.bombRadiusH, bv = view.bombRadiusV;
  const oppScore = view.mineCount - view.remainMines - view.score;
  const winNeed = Math.floor(view.mineCount / 2) + 1;
  const wish = Math.floor(view.mineCount / total * (2 * bw + 1) * (2 * bv + 1));
  // 炸弹决策: 落后且期望收益大, 或接近胜利线
  if (view.canBomb) {
    const scoreDiff = Math.abs(view.score - oppScore);
    if ((scoreDiff > wish && Math.random() < 0.5) ||
        (winNeed - view.score < wish) || (winNeed - oppScore < wish && oppScore >= view.score)) {
      // 选隐藏格最多的矩形
      let bestCnt = -1, bx = 0, by = 0;
      for (let y = bv; y < h - bv; y++) for (let x = bw; x < w - bw; x++) {
        let cnt = 0;
        for (let dy = -bv; dy <= bv; dy++) for (let dx = -bw; dx <= bw; dx++) {
          if (view.cellAt(x + dx, y + dy) === -2) cnt++;
        }
        if (cnt > bestCnt) { bestCnt = cnt; bx = x; by = y; }
      }
      if (bestCnt > 0) return { type: 'bomb', x: bx, y: by };
    }
  }
  // 普通: 选概率最高
  let best = -1, bestP = -1;
  for (const [i, p] of prob) {
    const x = i % w, y = (i / w) | 0;
    if (view.cellAt(x, y) !== -2) continue;
    if (p > bestP) { bestP = p; best = i; }
  }
  if (best >= 0) return { type: 'open', x: best % w, y: (best / w) | 0 };
  const hidden = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (view.cellAt(x, y) === -2) hidden.push(x + y * w);
  if (hidden.length === 0) return null;
  const i = hidden[randInt(hidden.length)];
  return { type: 'open', x: i % w, y: (i / w) | 0 };
}


window.MineCore.computeProbabilities = computeProbabilities;
window.MineCore.strongDecide = strongDecide;
})();
