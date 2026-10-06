"use strict";

(() => {
  function resolve(game, player, decision, options = {}) {
    const width = game.w;
    const height = game.h;
    const legalOpens = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!game.revealed[y * width + x]) legalOpens.push({ type: 'open', x, y });
    }
    if (legalOpens.length === 0) return { action: null, invalid: false, noMoves: true };

    const isCell = (x, y) => Number.isInteger(x) && Number.isInteger(y) &&
      x >= 0 && y >= 0 && x < width && y < height;
    const isHidden = (x, y) => isCell(x, y) && !game.revealed[y * width + x];
    const suppliedFallback = options.fallbackDecision;
    const fallback = suppliedFallback?.type === 'open' && isHidden(suppliedFallback.x, suppliedFallback.y)
      ? { type: 'open', x: suppliedFallback.x, y: suppliedFallback.y }
      : legalOpens[0];

    if (decision?.type === 'open' && isHidden(decision.x, decision.y)) {
      return { action: { type: 'open', x: decision.x, y: decision.y }, invalid: false, noMoves: false };
    }
    if (decision?.type === 'bomb' && isCell(decision.x, decision.y) && game.canBomb(player, { ai: true })) {
      return { action: { type: 'bomb', x: decision.x, y: decision.y }, invalid: false, noMoves: false };
    }
    return { action: fallback, invalid: true, noMoves: false };
  }

  window.MineAIDecision = { resolve };
})();
