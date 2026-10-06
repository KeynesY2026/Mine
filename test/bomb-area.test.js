const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  window: {},
  crypto: { getRandomValues: array => { array[0] = 0; return array; } },
};
vm.runInNewContext(fs.readFileSync('js/core.js', 'utf8'), context);
const { Game } = context.window.MineCore;

function game(width = 15, height = 15) {
  return new Game({ width, height, mineCount: 0, bombCount: 1 });
}

function knownComponentCount(board) {
  const visited = new Uint8Array(board.total);
  let count = 0;
  for (let start = 0; start < board.total; start++) {
    if (!board.revealed[start] || visited[start]) continue;
    count++;
    const stack = [start];
    visited[start] = 1;
    while (stack.length) {
      const cell = stack.pop();
      const x = cell % board.w, y = Math.floor(cell / board.w);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= board.w || ny >= board.h) continue;
        const next = ny * board.w + nx;
        if (board.revealed[next] && !visited[next]) { visited[next] = 1; stack.push(next); }
      }
    }
  }
  return count;
}

function configuredGame({ width = 15, height = 15, mineCount, mines = [], revealed = [],
  blueScore = 0, redScore = 1, disableAiBombs = false }) {
  const board = new Game({ width, height, mineCount, bombCount: 1, disableAiBombs });
  board.mines.fill(0);
  for (const index of mines) board.mines[index] = 1;
  board.revealed.fill(0);
  for (const index of revealed) board.revealed[index] = 1;
  board.hiddenCount = board.total - revealed.length;
  board.scores = { blue: blueScore, red: redScore };
  board.turn = 'blue';
  board.over = false;
  board.winner = null;
  return board;
}

test('bombAreaCells returns the full centered blast rectangle', () => {
  const board = game();
  assert.deepEqual(Array.from(board.bombAreaCells(7, 7)), Array.from({ length: 25 }, (_, i) =>
    Math.floor(i / 5 + 5) * 15 + (i % 5) + 5));
});

test('bombAreaCells clips the rectangle at board edges', () => {
  const board = game();
  assert.deepEqual(Array.from(board.bombAreaCells(0, 0)), [0, 1, 2, 15, 16, 17, 30, 31, 32]);
});

test('bomb blast remains 5x5 on boards with different dimensions', () => {
  for (const [width, height] of [[7, 7], [15, 9], [35, 35]]) {
    const board = game(width, height);
    assert.equal(board.bombRadiusH, 2);
    assert.equal(board.bombRadiusV, 2);
    assert.equal(board.bombAreaCells(3, 3).length, 25);
  }
});

test('small boards clip the fixed 5x5 blast without reducing its radius', () => {
  const board = game(7, 7);
  assert.deepEqual(Array.from(board.bombAreaCells(0, 0)), [0, 1, 2, 7, 8, 9, 14, 15, 16]);
});

test('bomb move reveals the same clipped area used for its preview', () => {
  const board = game();
  board.scores.red = 1;
  assert.equal(board.setBombMode(true), true);
  const result = board.bomb(0, 0);

  assert.equal(result.kind, 'bomb');
  assert.deepEqual(Array.from(result.cells), [0, 1, 2, 15, 16, 17, 30, 31, 32]);
});

test('core exposes an engine-only automatic bomb action', () => {
  const board = game();

  assert.equal(typeof board.bombBest, 'function');
});

test('AI view exposes only public cell reads and AI-specific bomb permission', () => {
  const board = new Game({ width: 7, height: 7, mineCount: 1, bombCount: 1, disableAiBombs: true });
  board.scores.red = 1;
  const before = board.bombs.blue;

  assert.equal(board.canBomb('blue'), true);
  assert.equal(board.canBomb('blue', { ai: true }), false);
  assert.equal(board.view('blue').canBomb, true);
  const view = board.view('blue', { ai: true });
  assert.equal(view.canBomb, false);
  assert.equal(view.cellAt(0, 0), -2);
  assert.equal(Object.hasOwn(view, 'mines'), false);
  assert.equal(Object.hasOwn(view, 'revealed'), false);
  assert.equal(Object.hasOwn(view, 'numbers'), false);
  assert.equal(board.bombs.blue, before);
});

test('bomb rejects a revealed center without spending a bomb or revealing its blast', () => {
  for (const ai of [false, true]) {
    const board = game();
    board.scores.red = 1;
    board.revealed[0] = 1;
    board.hiddenCount--;
    const before = {
      bombs: board.bombs.blue,
      rounds: board.rounds.blue,
      hiddenCount: board.hiddenCount,
      turn: board.turn,
      revealed: Array.from(board.revealed),
      lastMove: board.lastMove,
    };

    assert.deepEqual(JSON.parse(JSON.stringify(board.bomb(0, 0, { ai }))), {
      ok: false, why: 'center-not-hidden',
    });
    assert.equal(board.bombs.blue, before.bombs);
    assert.equal(board.rounds.blue, before.rounds);
    assert.equal(board.hiddenCount, before.hiddenCount);
    assert.equal(board.turn, before.turn);
    assert.deepEqual(Array.from(board.revealed), before.revealed);
    assert.equal(board.lastMove, before.lastMove);
  }
});

test('coordinate AI bomb actions execute the specified center', () => {
  const board = game();
  board.scores.red = 1;
  const result = board.bomb(3, 3, { ai: true });

  assert.equal(result.ok, true);
  assert.deepEqual([result.x, result.y], [3, 3]);
  assert.equal(board.bombs.blue, 0);
});


test('BombBest respects AI bomb disablement and does not choose revealed centers', () => {
  const disabled = configuredGame({ mineCount: 2, mines: [0, 1], revealed: [0], disableAiBombs: true });
  const disabledBefore = [disabled.bombs.blue, disabled.rounds.blue, disabled.hiddenCount, disabled.turn];
  assert.deepEqual(JSON.parse(JSON.stringify(disabled.bombBest())), { ok: false, why: 'cannot' });
  assert.deepEqual([disabled.bombs.blue, disabled.rounds.blue, disabled.hiddenCount, disabled.turn], disabledBefore);

  const revealed = configuredGame({
    width: 7, height: 7, mineCount: 1, mines: [0],
    revealed: Array.from({ length: 49 }, (_, index) => index),
  });
  const revealedBefore = [revealed.bombs.blue, revealed.rounds.blue, revealed.hiddenCount, revealed.turn];
  assert.deepEqual(JSON.parse(JSON.stringify(revealed.bombBest())), { ok: false, why: 'no-target' });
  assert.deepEqual([revealed.bombs.blue, revealed.rounds.blue, revealed.hiddenCount, revealed.turn], revealedBefore);
});

test('BombBest immediate-win-only mode allows a direct win despite deficit and component filters', () => {
  const index = (x, y) => y * 11 + x;
  const board = configuredGame({
    width: 11, height: 11, mineCount: 5,
    mines: [index(0, 0), index(9, 9), index(10, 9), index(9, 10), index(10, 10)],
    revealed: [index(0, 0)],
  });

  assert.equal(knownComponentCount(board), 1);
  const result = board.bombBest({ immediateWinOnly: true });

  assert.equal(result.ok, true);
  assert.equal(result.mines, 4);
  assert.equal(knownComponentCount(board), 2);
  assert.equal(board.scores.blue, 4);
  assert.equal(board.winner, 'blue');
});

test('BombBest immediate-win-only mode preserves the last bomb when no blast wins', () => {
  const index = (x, y) => y * 7 + x;
  const mines = [index(0, 0), index(6, 0), index(0, 6), index(6, 6)];
  const board = configuredGame({
    width: 7, height: 7, mineCount: 4, mines,
    revealed: [index(3, 3)], blueScore: 0, redScore: 3,
  });
  const before = [board.bombs.blue, board.rounds.blue, board.hiddenCount, board.turn];

  assert.deepEqual(JSON.parse(JSON.stringify(board.bombBest({ immediateWinOnly: true }))), {
    ok: false, why: 'no-target',
  });
  assert.deepEqual([board.bombs.blue, board.rounds.blue, board.hiddenCount, board.turn], before);
});

test('BombBest refuses non-winning automatic bombs when the deficit is below three', () => {
  const index = (x, y) => y * 15 + x;
  const hiddenMines = [index(3, 3), index(9, 3), index(3, 9), index(9, 9)];
  const revealed = Array.from({ length: 225 }, (_, cell) => cell).filter(cell => !hiddenMines.includes(cell));
  const board = configuredGame({
    width: 15, height: 15, mineCount: 6,
    mines: [index(0, 0), index(1, 0), ...hiddenMines],
    revealed,
    blueScore: 0, redScore: 2,
  });
  const before = [board.bombs.blue, board.rounds.blue, board.hiddenCount, board.turn];

  assert.deepEqual(JSON.parse(JSON.stringify(board.bombBest())), { ok: false, why: 'no-target' });
  assert.deepEqual([board.bombs.blue, board.rounds.blue, board.hiddenCount, board.turn], before);
});

test('BombBest excludes candidates that create a new known component, then maximizes actual hits', () => {
  const index = (x, y) => y * 11 + x;
  const board = configuredGame({
    width: 11, height: 11, mineCount: 10,
    mines: [
      index(0, 0), index(1, 0), index(0, 1),
      index(1, 1), index(2, 2),
      index(9, 9), index(9, 10), index(10, 9),
      index(6, 6), index(6, 7),
    ],
    revealed: [index(0, 0), index(1, 0), index(0, 1)],
    blueScore: 0, redScore: 3,
  });

  const result = board.bombBest();

  assert.equal(result.ok, true);
  assert.equal(result.mines, 2);
  assert.equal(board.scores.blue, 2);
  assert.ok(result.x <= 4 && result.y <= 4, 'the isolated three-hit region is ineligible');
});

test('bomb count is clamped to 0..999 and defaults to one', () => {
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1 }).bombMax, 1);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: 1200 }).bombMax, 999);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: -4 }).bombMax, 0);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: 'invalid' }).bombMax, 1);
});
