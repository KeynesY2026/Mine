/* 雷暴 MineStorm — core: 工具函数 + 雷图生成 + Game 规则类 (不依赖 DOM)
   加载顺序: 第一个 (index.html)。导出: window.MineCore { clamp, randInt, neighbours, eachNei, makeMap, computeMineCount, Game }
   随后 js/ai-weak.js / js/ai-strong.js 会把 weakDecide / strongDecide / computeProbabilities 挂回 MineCore */
"use strict";
const MineCore = (() => {

/* ---------------- 工具 ---------------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const randInt = n => (Math.random() * n) | 0;

// 邻居表缓存
const NEICACHE = new Map();
function neighbours(w, h) {
  const key = w * 1000 + h;
  let e = NEICACHE.get(key);
  if (e) return e;
  const total = w * h;
  const NEI = new Int32Array(total * 8);
  const NEICnt = new Uint8Array(total);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) NEI[i * 8 + k++] = ny * w + nx;
    }
    NEICnt[i] = k;
  }
  e = { w, h, total, NEI, NEICnt };
  NEICACHE.set(key, e);
  return e;
}
function eachNei(nb, i, fn) {
  const n = nb.NEICnt[i];
  for (let k = 0; k < n; k++) fn(nb.NEI[i * 8 + k]);
}

/* ---------------- 雷图生成 (移植 MakeMap 聚集公式) ----------------
   每个候选位: 若 (1+邻雷)/(1+邻格) <= 平均密度, 或 rand<0.1, 或连续21次未落 → 落雷 */
function makeMap(w, h, count) {
  const total = w * h;
  const map = new Uint8Array(total);
  if (count <= 0) return map;
  const nb = neighbours(w, h);
  const avg = count / total;
  let c = count, maxSkipRound = 0;
  while (c > 0) {
    const pos = randInt(total);
    if (!map[pos]) {
      let nmc = 1, tcc = 1;
      eachNei(nb, pos, j => { tcc++; if (map[j]) nmc++; });
      if (nmc / tcc <= avg || Math.random() < 0.1 || maxSkipRound < 0) {
        map[pos] = 1; c--; maxSkipRound = 20;
      }
      maxSkipRound--;
    }
  }
  return map;
}
// 雷数配置: 总数*密度/100, 强制奇数, clamp <= total-2 (修复原版 no-op)
function computeMineCount(w, h, pct) {
  let m = Math.round((w * h * pct) / 100);
  if (m % 2 === 0) m += 1; // 修复原版 no-op: 先取整再判奇偶
  return clamp(m, 1, w * h - 2);
}

/* ---------------- 规则引擎 (移植 Chess.cpp + ChessCell.cpp) ---------------- */
class Game {
  constructor(cfg) {
    this.cfg = cfg;
    this.w = cfg.width; this.h = cfg.height; this.total = this.w * this.h;
    this.mineCount = cfg.mineCount;
    this.bombRadiusH = Math.floor(this.w / 7);
    this.bombRadiusV = Math.floor(this.h / 7);
    this.bombMax = cfg.bombCount;
    this.nb = neighbours(this.w, this.h);
    this._subs = [];
    this.reset();
  }
  reset() {
    this.mines = makeMap(this.w, this.h, this.mineCount);
    this.revealed = new Uint8Array(this.total);
    this.owner = new Uint8Array(this.total);
    this.numbers = new Int8Array(this.total);
    for (let i = 0; i < this.total; i++) {
      let n = 0;
      eachNei(this.nb, i, j => { if (this.mines[j]) n++; });
      this.numbers[i] = n;
    }
    this.scores = { blue: 0, red: 0 };
    this.bombs = { blue: this.bombMax, red: this.bombMax };
    this.rounds = { blue: 0, red: 0 };
    this.turn = 'blue';
    this.bombMode = false;
    this.over = false;
    this.winner = null;
    this.hiddenCount = this.total;
    this.lastMove = null;
  }
  subscribe(fn) { this._subs.push(fn); }
  _emit(evt) { for (const fn of this._subs) fn(evt); }

  get scoreTotal() { return this.scores.blue + this.scores.red; }
  get remainMines() { return this.mineCount - this.scoreTotal; }
  get winNeed() { return Math.floor(this.mineCount / 2) + 1; }
  isPlayerTurn(p) { return this.turn === p && !this.over; }
  canBomb(p) {
    if (this.over) return false;
    const me = this.scores[p], opp = this.scores[p === 'blue' ? 'red' : 'blue'];
    return me < opp && this.bombs[p] > 0;
  }
  setBombMode(on) {
    on = !!on;
    if (this.bombMode === on) return this.bombMode;
    if (on && !this.canBomb(this.turn)) return false;
    this.bombMode = on;
    return this.bombMode;
  }
  _reveal(i, who) {
    if (this.revealed[i]) return false;
    this.revealed[i] = 1; this.owner[i] = who; this.hiddenCount--;
    return true;
  }
  _checkOver() {
    if (this.over) return;
    const { blue, red } = this.scores;
    if (blue > this.mineCount / 2 || red > this.mineCount / 2) {
      this.over = true; this.winner = blue > red ? 'blue' : 'red';
    } else if (this.hiddenCount === 0) {
      // 修复原版 soft-lock: 棋盘耗尽按比分判定
      this.over = true;
      this.winner = blue > red ? 'blue' : red > blue ? 'red' : 'draw';
    }
  }
  open(x, y) {
    if (this.over || this.bombMode) return { ok: false };
    const i = y * this.w + x;
    if (i < 0 || i >= this.total || this.revealed[i]) return { ok: false };
    const who = this.turn === 'blue' ? 1 : 2;
    const me = this.turn;
    if (this.mines[i]) {
      this._reveal(i, who);
      this.scores[me]++; this.rounds[me]++;
      this.lastMove = { kind: 'mine', cells: [i], player: me, goOn: true, x, y };
      this._checkOver();
      this._emit(this.lastMove);
      return { ok: true, kind: 'mine', goOn: true, cells: [i] };
    }
    const num = this.numbers[i];
    let goOn = false;
    const cells = [];
    if (num === 0) {
      const queue = [i]; let qh = 0;
      while (qh < queue.length) {
        const c = queue[qh++];
        if (!this._reveal(c, who)) continue;
        cells.push(c);
        if (this.numbers[c] === 0) eachNei(this.nb, c, j => { if (!this.revealed[j]) queue.push(j); });
      }
    } else {
      this._reveal(i, who); cells.push(i);
    }
    this.rounds[me]++;
    this.lastMove = { kind: num === 0 ? 'empty' : 'number', cells, player: me, goOn, x, y };
    if (!goOn) this.turn = me === 'blue' ? 'red' : 'blue';
    this.bombMode = false;
    this._checkOver();
    this._emit(this.lastMove);
    return { ok: true, kind: num === 0 ? 'empty' : 'number', goOn, cells };
  }
  bombAreaCells(x, y) {
    const cells = [];
    for (let dy = -this.bombRadiusV; dy <= this.bombRadiusV; dy++) {
      for (let dx = -this.bombRadiusH; dx <= this.bombRadiusH; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < this.w && ny < this.h) cells.push(ny * this.w + nx);
      }
    }
    return cells;
  }
  bomb(x, y) {
    if (this.over) return { ok: false };
    if (!this.canBomb(this.turn)) { this.bombMode = false; return { ok: false, why: 'cannot' }; }
    const who = this.turn === 'blue' ? 1 : 2;
    const me = this.turn;
    this.bombs[me]--; this.rounds[me]++;
    let mineHit = 0; const cells = [];
    for (const j of this.bombAreaCells(x, y)) {
      if (this._reveal(j, who)) { cells.push(j); if (this.mines[j]) mineHit++; }
    }
    this.scores[me] += mineHit;
    this.bombMode = false;
    this.turn = me === 'blue' ? 'red' : 'blue';
    this.lastMove = { kind: 'bomb', cells, mines: mineHit, player: me, x, y };
    this._checkOver();
    this._emit(this.lastMove);
    return { ok: true, kind: 'bomb', x, y, mines: mineHit, cells };
  }
  // AI / 插件只读视图 (镜像 IChess, 额外 oppScore/bombs/turn)
  view(forPlayer) {
    const p = forPlayer || this.turn;
    const opp = p === 'blue' ? 'red' : 'blue';
    const self = this;
    return {
      width: this.w, height: this.h,
      cellAt(x, y) {
        const i = y * self.w + x;
        if (i < 0 || i >= self.total || !self.revealed[i]) return -2;
        return self.mines[i] ? -1 : self.numbers[i];
      },
      score: this.scores[p], oppScore: this.scores[opp],
      mineCount: this.mineCount, remainMines: this.remainMines,
      bombs: this.bombs[p], canBomb: this.canBomb(p),
      bombRadiusH: this.bombRadiusH, bombRadiusV: this.bombRadiusV, turn: p,
    };
  }
}

return {
  clamp, randInt, neighbours, eachNei,
  makeMap, computeMineCount, Game,
};
})();
window.MineCore = MineCore;
