"use strict";

(() => {
  function resolve(game, player, decision, options = {}) {
    const width = game.w;
    const height = game.h;
    const legalOpens = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!game.revealed[y * width + x]) legalOpens.push({ type: 'open', x, y });
      }
    }
    if (legalOpens.length === 0) return { action: null, invalid: false, noMoves: true };

    const isCell = (x, y) => Number.isInteger(x) && Number.isInteger(y) &&
      x >= 0 && y >= 0 && x < width && y < height;
    const isHidden = (x, y) => isCell(x, y) && !game.revealed[y * width + x];
    if (decision?.type === 'open' && isHidden(decision.x, decision.y)) {
      return { action: { type: 'open', x: decision.x, y: decision.y }, invalid: false, noMoves: false };
    }

    if (decision?.type === 'bomb' && game.canBomb(player, { ai: true })) {
      if (options.enhancedAI) return { action: { type: 'bomb-auto' }, invalid: false, noMoves: false };
      if (isCell(decision.x, decision.y)) {
        return { action: { type: 'bomb', x: decision.x, y: decision.y }, invalid: false, noMoves: false };
      }
    }

    const choose = options.randomIndex || window.MineCore.randInt;
    const requestedIndex = Number(choose(legalOpens.length));
    const index = Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < legalOpens.length
      ? requestedIndex : 0;
    return { action: legalOpens[index], invalid: true, noMoves: false };
  }

  window.MineAIDecision = { resolve };
})();
