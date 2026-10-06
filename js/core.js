/* 雷暴 MineStorm — core: 工具函数 + 雷图生成 + Game 规则类 (不依赖 DOM)
   加载顺序: 第一个 (index.html)。导出: window.MineCore { clamp, randInt, neighbours, eachNei, makeMap, computeMineCount, Game }
   对局选中的 AI 插件会按需从 plugin/ 加载，并使用此处导出的基础函数 */
"use strict";
const MineCore = (() => {

/* ---------------- 工具 ---------------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const RANDOM_RANGE = 0x100000000;
function randomUint32() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Secure randomness requires Web Crypto (crypto.getRandomValues).');
  }
  const value = new Uint32Array(1);
  cryptoApi.getRandomValues(value);
  return value[0];
}
function randInt(n) {
  if (!Number.isSafeInteger(n) || n <= 0 || n > RANDOM_RANGE) {
    throw new RangeError('randInt upper bound must be an integer from 1 to 2^32.');
  }
  const limit = Math.floor(RANDOM_RANGE / n) * n;
  let value;
  do { value = randomUint32(); } while (value >= limit);
  return value % n;
}

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
function knownComponentCount(revealed, w, h) {
  const nb = neighbours(w, h);
  const visited = new Uint8Array(w * h);
  let count = 0;
  for (let start = 0; start < revealed.length; start++) {
    if (!revealed[start] || visited[start]) continue;
    count++;
    const stack = [start];
    visited[start] = 1;
    while (stack.length) {
      const cell = stack.pop();
      eachNei(nb, cell, next => {
        if (revealed[next] && !visited[next]) {
          visited[next] = 1;
          stack.push(next);
        }
      });
    }
  }
  return count;
}

/* ---------------- 雷图生成：安全随机、尽量均匀铺开 ----------------
   每次放在距离已有地雷最远的候选格；距离并列时用安全随机数打破平局。 */
function makeMap(w, h, count) {
  const total = w * h;
  const map = new Uint8Array(total);
  const mineTotal = Math.min(total, Math.max(0, Math.trunc(count)));
  if (mineTotal === 0) return map;

  const nearestMineDistance = new Float64Array(total);
  nearestMineDistance.fill(Infinity);
  for (let placed = 0; placed < mineTotal; placed++) {
    let farthest = -1;
    const candidates = [];
    for (let i = 0; i < total; i++) {
      if (map[i]) continue;
      const distance = nearestMineDistance[i];
      if (distance > farthest) {
        farthest = distance;
        candidates.length = 0;
        candidates.push(i);
      } else if (distance === farthest) {
        candidates.push(i);
      }
    }

    const pos = candidates[randInt(candidates.length)];
    map[pos] = 1;
    const px = pos % w, py = Math.floor(pos / w);
    for (let i = 0; i < total; i++) {
      const dx = i % w - px, dy = Math.floor(i / w) - py;
      const distance = dx * dx + dy * dy;
      if (distance < nearestMineDistance[i]) nearestMineDistance[i] = distance;
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
    this.bombRadiusH = 2;
    this.bombRadiusV = 2;
    const requestedBombCount = cfg.bombCount === '' || cfg.bombCount == null ? NaN : Number(cfg.bombCount);
    this.bombMax = Number.isFinite(requestedBombCount) ? clamp(Math.trunc(requestedBombCount), 0, 999) : 1;
    this.disableAiBombs = !!cfg.disableAiBombs;
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
  canBomb(p, { ai = false } = {}) {
    if (this.over || (ai && this.disableAiBombs)) return false;
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
  bombBest() {
    if (!this.canBomb(this.turn, { ai: true })) return { ok: false, why: 'cannot' };
    const me = this.turn;
    const score = this.scores[me];
    const oppScore = this.scores[me === 'blue' ? 'red' : 'blue'];
    const deficit = oppScore - score;
    const componentCountBefore = knownComponentCount(this.revealed, this.w, this.h);
    const eligible = [];

    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const center = y * this.w + x;
      if (this.revealed[center]) continue;
      const area = this.bombAreaCells(x, y);
      const afterBlast = this.revealed.slice();
      let mineHits = 0;
      for (const cell of area) {
        if (!afterBlast[cell]) {
          afterBlast[cell] = 1;
          if (this.mines[cell]) mineHits++;
        }
      }
      const immediateWin = score + mineHits >= this.winNeed;
      if (!immediateWin && (deficit < 3 ||
          knownComponentCount(afterBlast, this.w, this.h) > componentCountBefore)) continue;
      eligible.push({ x, y, mineHits });
    }

    if (!eligible.length) return { ok: false, why: 'no-target' };
    const bestHits = Math.max(...eligible.map(candidate => candidate.mineHits));
    const best = eligible.filter(candidate => candidate.mineHits === bestHits);
    const chosen = best[randInt(best.length)];
    return this.bomb(chosen.x, chosen.y, { ai: true });
  }
  bomb(x, y, { ai = false } = {}) {
    if (this.over) return { ok: false };
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.w || y >= this.h) {
      this.bombMode = false;
      return { ok: false, why: 'invalid-target' };
    }
    if (this.revealed[y * this.w + x]) return { ok: false, why: 'center-not-hidden' };
    if (!this.canBomb(this.turn, { ai })) { this.bombMode = false; return { ok: false, why: 'cannot' }; }
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
  view(forPlayer, { ai = false } = {}) {
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
      bombs: this.bombs[p], canBomb: this.canBomb(p, { ai }),
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
