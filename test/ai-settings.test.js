const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
const source = fs.existsSync('js/game-settings.js') ? fs.readFileSync('js/game-settings.js', 'utf8') : '';
vm.runInNewContext(source, context);
const settings = context.window.MineGameSettings;

function api() {
  assert.ok(settings, 'game settings normalizers are available');
  return settings;
}

test('bomb count normalization accepts 0, 1, and 999 and clamps above the limit', () => {
  const { normalizeBombCount } = api();
  assert.equal(normalizeBombCount(0), 0);
  assert.equal(normalizeBombCount(1), 1);
  assert.equal(normalizeBombCount(999), 999);
  assert.equal(normalizeBombCount(1000), 999);
  assert.equal(normalizeBombCount(-5), 0);
  assert.equal(normalizeBombCount('invalid'), 1);
});

test('manual mine count is odd and stays within a playable board range', () => {
  const { normalizeMineCount } = api();
  assert.equal(normalizeMineCount(10, 7, 7), 11);
  assert.equal(normalizeMineCount(999, 7, 8), 53);
  assert.equal(normalizeMineCount(99, 0, 0), 47);
  assert.equal(normalizeMineCount(0, 7, 7), 1);
});

test('bomb status formatting scales to large inventories without icon lists', () => {
  const { formatBombStatus } = api();
  assert.equal(formatBombStatus(999, 999), '剩余炸弹 999/999');
  assert.equal(formatBombStatus(0, 0), '本局无炸弹');
});
