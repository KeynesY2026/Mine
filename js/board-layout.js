(() => {
  const MIN_CELL_SIZE = 24;
  const CELL_GAP = 3;
  const BOARD_CHROME = 20;

  function cellSize(width, height, availableWidth, availableHeight) {
    const columns = Math.max(1, Math.floor(Number(width) || 1));
    const rows = Math.max(1, Math.floor(Number(height) || 1));
    const viewportWidth = Math.max(0, Number(availableWidth) || 0);
    const viewportHeight = Math.max(0, Number(availableHeight) || 0);
    const fitWidth = (viewportWidth - BOARD_CHROME - (columns - 1) * CELL_GAP) / columns;
    const fitHeight = (viewportHeight - BOARD_CHROME - (rows - 1) * CELL_GAP) / rows;
    return Math.max(MIN_CELL_SIZE, Math.floor(Math.min(fitWidth, fitHeight)));
  }

  window.MineBoardLayout = { cellSize };
})();
