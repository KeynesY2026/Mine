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

test('core does not expose hidden-map automatic bomb selection', () => {
  assert.equal(typeof game().bombBest, 'undefined');
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


test('AI bombs remain disabled at the engine boundary without spending inventory', () => {
  const board = new Game({ width: 7, height: 7, mineCount: 1, bombCount: 1, disableAiBombs: true });
  board.scores.red = 1;
  const before = [board.bombs.blue, board.rounds.blue, board.hiddenCount, board.turn];

  assert.deepEqual(JSON.parse(JSON.stringify(board.bomb(3, 3, { ai: true }))), {
    ok: false, why: 'cannot',
  });
  assert.deepEqual([board.bombs.blue, board.rounds.blue, board.hiddenCount, board.turn], before);
});

test('bomb count is clamped to 0..999 and defaults to one', () => {
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1 }).bombMax, 1);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: 1200 }).bombMax, 999);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: -4 }).bombMax, 0);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: 'invalid' }).bombMax, 1);
});
