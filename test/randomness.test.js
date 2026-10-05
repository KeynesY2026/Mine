const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadCore(values = []) {
  let calls = 0;
  const sandbox = {
    window: {},
    crypto: {
      getRandomValues(array) {
        calls++;
        array[0] = values.length ? values.shift() : 0;
        return array;
      },
    },
    Math: Object.assign(Object.create(Math), { random: () => {
      throw new Error('Math.random must not be used');
    } }),
  };
  vm.runInNewContext(fs.readFileSync('js/core.js', 'utf8'), sandbox);
  return { core: sandbox.window.MineCore, getCryptoCalls: () => calls };
}

test('randInt uses Web Crypto and rejection sampling for unbiased bounds', () => {
  const { core, getCryptoCalls } = loadCore([0xffffffff, 5]);

  assert.equal(core.randInt(10), 5);
  assert.equal(getCryptoCalls(), 2);
});

test('mine layout keeps the requested count while spacing mines across the board', () => {
  const { core, getCryptoCalls } = loadCore();
  const width = 8;
  const height = 8;
  const count = 8;
  const map = core.makeMap(width, height, count);
  const mines = [];
  for (let i = 0; i < map.length; i++) if (map[i]) mines.push(i);

  assert.equal(mines.length, count);
  let minDistance = Infinity;
  for (let a = 0; a < mines.length; a++) {
    for (let b = 0; b < a; b++) {
      const dx = mines[a] % width - mines[b] % width;
      const dy = Math.floor(mines[a] / width) - Math.floor(mines[b] / width);
      minDistance = Math.min(minDistance, Math.hypot(dx, dy));
    }
  }
  assert.ok(minDistance >= 2, `minimum mine spacing was ${minDistance}`);
  assert.ok(getCryptoCalls() > 0, 'mine placement must use Web Crypto');
});

test('application random choices do not call Math.random directly', () => {
  const paths = [
    'js/core.js',
    'js/ai-decision.js',
    'plugin/ai-heuristic.js',
    'plugin/ai-global-probability.js',
    'plugin/ai-constraint-probability.js',
  ];
  const offenders = paths.filter(path => /\bMath\.random\s*\(/.test(fs.readFileSync(path, 'utf8')));

  assert.deepEqual(offenders, []);
});
