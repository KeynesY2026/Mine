"use strict";

(() => {
  function create(now = () => performance.now()) {
    const totals = { blue: 0, red: 0 };
    let currentPlayer = null;
    let startedAt = null;

    function start(player) {
      if (player !== 'blue' && player !== 'red') return;
      currentPlayer = player;
      startedAt = now();
    }

    function endTurn(player, nextPlayer, nextIsHuman, gameOver = false) {
      const endedAt = now();
      if (player === currentPlayer && startedAt !== null) {
        totals[player] += Math.max(0, endedAt - startedAt);
      }
      currentPlayer = null;
      startedAt = null;
      if (!gameOver && nextIsHuman) start(nextPlayer);
    }

    function elapsed(player, includeActive = true) {
      if (player !== 'blue' && player !== 'red') return 0;
      const active = includeActive && player === currentPlayer && startedAt !== null
        ? Math.max(0, now() - startedAt) : 0;
      return totals[player] + active;
    }

    function reset() {
      totals.blue = 0;
      totals.red = 0;
      currentPlayer = null;
      startedAt = null;
    }

    return { start, endTurn, elapsed, reset };
  }

  window.MineTurnTimer = { create };
})();
