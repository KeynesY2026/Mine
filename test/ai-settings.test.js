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

test('bomb count normalization accepts 0–99 and clamps larger values to 99', () => {
  const { normalizeBombCount } = api();
  assert.equal(normalizeBombCount(0), 0);
  assert.equal(normalizeBombCount(1), 1);
  assert.equal(normalizeBombCount(99), 99);
  assert.equal(normalizeBombCount(100), 99);
  assert.equal(normalizeBombCount(-5), 0);
  assert.equal(normalizeBombCount('invalid'), 1);
});

test('mine counts stay odd within the 10–99 square-board bounds', () => {
  const { normalizeMineCount } = api();
  assert.equal(normalizeMineCount(10, 10, 10), 11);
  assert.equal(normalizeMineCount(999, 0, 0), 97);
  assert.equal(normalizeMineCount(999, 10, 99), 987);
  assert.equal(normalizeMineCount(9999, 99, 99), 9799);
  assert.equal(normalizeMineCount(0, 10, 10), 1);
});

test('density-derived mine counts stay odd at minimum and maximum board sizes', () => {
  const { resolveMineCount } = api();
  assert.equal(resolveMineCount({ width: 15, height: 15, densityPercent: 23 }), 53);
  assert.equal(resolveMineCount({ width: 10, height: 10, densityPercent: 10 }), 11);
  assert.equal(resolveMineCount({ width: 99, height: 99, densityPercent: 90 }), 8821);
});

test('bomb inventory uses one icon per bomb below five and a multiplier from five onward', () => {
  const { formatBombInventory } = api();
  assert.deepEqual(JSON.parse(JSON.stringify(formatBombInventory(0))), {
    iconCount: 0, multiplier: null, empty: true, label: '已用尽炸弹',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(formatBombInventory(4))), {
    iconCount: 4, multiplier: null, empty: false, label: '剩余 4 枚炸弹',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(formatBombInventory(5))), {
    iconCount: 1, multiplier: 5, empty: false, label: '剩余 5 枚炸弹',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(formatBombInventory(100))), {
    iconCount: 1, multiplier: 99, empty: false, label: '剩余 99 枚炸弹',
  });
});
