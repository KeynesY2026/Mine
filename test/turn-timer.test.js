const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
const source = fs.readFileSync('js/turn-timer.js', 'utf8');
vm.runInNewContext(source, context);
const create = context.window.MineTurnTimer?.create;

 test('human active-turn time accumulates only their own turns and includes consecutive mine captures', () => {
  assert.equal(typeof create, 'function', 'turn timer module is available');
  let now = 1000;
  const timer = create(() => now);

  timer.start('blue');
  now = 4000;
  timer.endTurn('blue', 'red', false, false);
  assert.equal(timer.elapsed('blue'), 3000);

  now = 10000;
  timer.endTurn('red', 'blue', true, false);
  assert.equal(timer.elapsed('blue'), 3000);
  now = 12000;
  timer.endTurn('blue', 'blue', true, false);
  assert.equal(timer.elapsed('blue'), 5000);
  now = 13500;
  timer.endTurn('blue', null, false, true);
  assert.equal(timer.elapsed('blue'), 6500);
  assert.equal(timer.elapsed('red'), 0);
  assert.equal(timer.elapsed('blue', true), 6500);
});
