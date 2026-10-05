"use strict";

(() => {
  function normalizeBombCount(value) {
    if (value === '' || value == null) return 1;
    const count = Number(value);
    if (!Number.isFinite(count)) return 1;
    return Math.max(0, Math.min(999, Math.trunc(count)));
  }

  function normalizeMineCount(value, width, height) {
    const normalizeDimension = value => {
      const number = value === '' || value == null ? 15 : Number(value);
      return Math.max(7, Math.min(35, Math.round(Number.isFinite(number) ? number : 15)));
    };
    const w = normalizeDimension(width);
    const h = normalizeDimension(height);
    const total = w * h;
    let count = value === '' || value == null ? NaN : Number(value);
    if (!Number.isFinite(count)) count = 1;
    count = Math.round(count);
    if (count % 2 === 0) count++;
    let maxOdd = total - 2;
    if (maxOdd % 2 === 0) maxOdd--;
    return Math.max(1, Math.min(maxOdd, count));
  }

  function formatBombStatus(remaining, total) {
    const inventory = normalizeBombCount(total);
    if (inventory === 0) return '本局无炸弹';
    const left = Math.max(0, Math.min(inventory, normalizeBombCount(remaining)));
    return `剩余炸弹 ${left}/${inventory}`;
  }

  window.MineGameSettings = { normalizeBombCount, normalizeMineCount, formatBombStatus };
})();
