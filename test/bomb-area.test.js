const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
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

test('bomb move reveals the same clipped area used for its preview', () => {
  const board = game();
  board.scores.red = 1;
  assert.equal(board.setBombMode(true), true);
  const result = board.bomb(0, 0);

  assert.equal(result.kind, 'bomb');
  assert.deepEqual(Array.from(result.cells), [0, 1, 2, 15, 16, 17, 30, 31, 32]);
});
