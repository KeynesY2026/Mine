const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
const source = fs.existsSync('js/board-layout.js') ? fs.readFileSync('js/board-layout.js', 'utf8') : '';
vm.runInNewContext(source, context);
const layout = context.window.MineBoardLayout;

function api() {
  assert.ok(layout, 'responsive board layout helper is available');
  return layout;
}

test('large viewports can use cells larger than the former 44px ceiling', () => {
  assert.ok(api().cellSize(10, 10, 1200, 900) > 44);
});

test('99 by 99 boards retain usable 24px cells and overflow the scrollable viewport', () => {
  const size = api().cellSize(99, 99, 900, 620);
  assert.equal(size, 24);
  const boardExtent = 99 * size + 98 * 3 + 20;
  assert.ok(boardExtent > 900);
  assert.ok(boardExtent > 620);
});

test('square dimensions produce square geometry and never exceed a fitting viewport', () => {
  const size = api().cellSize(15, 15, 960, 720);
  const boardWidth = 15 * size + 14 * 3 + 20;
  const boardHeight = 15 * size + 14 * 3 + 20;
  assert.equal(boardWidth, boardHeight);
  assert.ok(boardWidth <= 960);
  assert.ok(boardHeight <= 720);
});
