const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
const source = fs.existsSync('js/mine-feedback.js') ? fs.readFileSync('js/mine-feedback.js', 'utf8') : '';
vm.runInNewContext(source, context);
const feedback = context.window.MineFeedback;

function api() {
  assert.ok(feedback, 'mine capture feedback helpers are available');
  return feedback;
}

test('opening a mine selects the newly captured mine for flag ceremony', () => {
  const { capturedMineIndices } = api();
  const mines = new Uint8Array([0, 1, 0, 1]);
  const owners = new Uint8Array([0, 1, 0, 0]);
  assert.deepEqual(Array.from(capturedMineIndices({ kind: 'mine', cells: [1] }, mines, owners)), [1]);
});

test('bomb move selects every owned mine hit while excluding empty cells and unowned mines', () => {
  const { capturedMineIndices } = api();
  const mines = new Uint8Array([0, 1, 1, 0, 1, 1]);
  const owners = new Uint8Array([0, 1, 2, 0, 0, 1]);
  const move = { kind: 'bomb', cells: [0, 1, 2, 3, 5], mines: 3, player: 'blue' };
  assert.deepEqual(Array.from(capturedMineIndices(move, mines, owners)), [1, 2, 5]);
});

test('non-capture moves and invalid cell indices do not trigger capture effects', () => {
  const { capturedMineIndices } = api();
  const mines = new Uint8Array([0, 1]);
  const owners = new Uint8Array([0, 1]);
  assert.deepEqual(Array.from(capturedMineIndices({ kind: 'number', cells: [1] }, mines, owners)), []);
  assert.deepEqual(Array.from(capturedMineIndices({ kind: 'bomb', cells: [-1, 2] }, mines, owners)), []);
});
