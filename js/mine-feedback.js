"use strict";

(() => {
  function capturedMineIndices(move, mines, owners) {
    if (!move || (move.kind !== 'mine' && move.kind !== 'bomb')
      || !Array.isArray(move.cells) || !mines || !owners
      || typeof mines.length !== 'number' || typeof owners.length !== 'number') return [];

    return move.cells.filter(index => Number.isInteger(index)
      && index >= 0 && index < mines.length
      && mines[index] === 1
      && (owners[index] === 1 || owners[index] === 2));
  }

  window.MineFeedback = { capturedMineIndices };
})();
