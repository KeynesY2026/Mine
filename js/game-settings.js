"use strict";

(() => {
  function normalizeBombCount(value) {
    if (value === '' || value == null) return 1;
    const count = Number(value);
    if (!Number.isFinite(count)) return 1;
    return Math.max(0, Math.min(99, Math.trunc(count)));
  }

  function normalizeMineCount(value, width, height) {
    const normalizeDimension = value => {
      const number = value === '' || value == null ? 15 : Number(value);
      return Math.max(10, Math.min(99, Math.round(Number.isFinite(number) ? number : 15)));
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

  function resolveMineCount(options = {}) {
    const width = options.width ?? 15;
    const height = options.height ?? 15;
    const density = Number(options.densityPercent);
    const percent = Math.max(10, Math.min(90, Number.isFinite(density) ? density : 23));
    return normalizeMineCount(width * height * percent / 100, width, height);
  }

  function formatBombInventory(remaining) {
    const count = normalizeBombCount(remaining);
    return {
      iconCount: count >= 5 ? 1 : count,
      multiplier: count >= 5 ? count : null,
      empty: count === 0,
      label: count === 0 ? '已用尽炸弹' : `剩余 ${count} 枚炸弹`,
    };
  }

  window.MineGameSettings = {
    normalizeBombCount, normalizeMineCount, resolveMineCount, formatBombInventory,
  };
})();
