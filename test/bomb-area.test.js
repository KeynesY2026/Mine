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

test('bomb move reveals the same clipped area used for its preview', () => {
  const board = game();
  board.scores.red = 1;
  assert.equal(board.setBombMode(true), true);
  const result = board.bomb(0, 0);

  assert.equal(result.kind, 'bomb');
  assert.deepEqual(Array.from(result.cells), [0, 1, 2, 15, 16, 17, 30, 31, 32]);
});

test('bombBest selects the center with the most unrevealed mines', () => {
  const board = new Game({ width: 7, height: 7, mineCount: 9, bombCount: 1 });
  board.mines.fill(0);
  for (const i of [16, 17, 18, 23, 24, 25, 30, 31, 32]) board.mines[i] = 1;
  board.scores.red = 1;

  const result = board.bombBest();

  assert.equal(result.ok, true);
  assert.deepEqual([result.x, result.y], [3, 3]);
  assert.equal(result.mines, 9);
  assert.equal(board.bombs.blue, 0);
});

test('bombBest uses row-major order for equally valuable regions', () => {
  const board = new Game({ width: 7, height: 7, mineCount: 1, bombCount: 1 });
  board.mines.fill(0);
  board.scores.red = 1;

  const result = board.bombBest();

  assert.equal(result.ok, true);
  assert.deepEqual([result.x, result.y], [0, 0]);
});

test('bombBest refuses to fire when bombing is illegal or AI bombs are disabled', () => {
  const board = new Game({ width: 7, height: 7, mineCount: 1, bombCount: 1, disableAiBombs: true });
  board.scores.red = 1;
  const before = board.bombs.blue;

  assert.equal(board.canBomb('blue'), true);
  assert.equal(board.canBomb('blue', { ai: true }), false);
  assert.equal(board.view('blue').canBomb, true);
  assert.equal(board.view('blue', { ai: true }).canBomb, false);
  assert.equal(board.bombBest().ok, false);
  assert.equal(board.bombs.blue, before);
});

test('AI view exposes only public cell reads and AI-specific bomb permission', () => {
  const board = new Game({ width: 7, height: 7, mineCount: 9, bombCount: 1, disableAiBombs: true });
  const view = board.view('blue', { ai: true });

  assert.equal(view.cellAt(0, 0), -2);
  assert.equal(view.canBomb, false);
  assert.equal(Object.hasOwn(view, 'mines'), false);
  assert.equal(Object.hasOwn(view, 'revealed'), false);
  assert.equal(Object.hasOwn(view, 'numbers'), false);
});

test('bomb count is clamped to 0..999 and defaults to one', () => {
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1 }).bombMax, 1);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: 1200 }).bombMax, 999);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: -4 }).bombMax, 0);
  assert.equal(new Game({ width: 7, height: 7, mineCount: 1, bombCount: 'invalid' }).bombMax, 1);
});
