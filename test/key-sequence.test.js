const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { window: {} };
const source = fs.existsSync('js/key-sequence.js') ? fs.readFileSync('js/key-sequence.js', 'utf8') : '';
vm.runInNewContext(source, context);
const create = context.window.MineKeySequence?.create;

function gate() {
  assert.equal(typeof create, 'function', 'key sequence detector is available');
  return create('cheat', 1500);
}

test('cheat unlocks case-insensitively only after the complete sequence', () => {
  const sequence = gate();
  assert.equal(sequence.isUnlocked(), false);
  for (const [index, key] of Array.from('CHEAT').entries()) {
    const unlocked = sequence.push(key, index * 100);
    assert.equal(unlocked, index === 4);
  }
  assert.equal(sequence.isUnlocked(), true);
});

test('a wrong character breaks the partial sequence but a new key can restart it', () => {
  const sequence = gate();
  for (const [index, key] of Array.from('chexat').entries()) sequence.push(key, index * 100);
  assert.equal(sequence.isUnlocked(), false);
  for (const [index, key] of Array.from('cheat').entries()) {
    sequence.push(key, 1000 + index * 100);
  }
  assert.equal(sequence.isUnlocked(), true);
});

test('a gap over 1500 milliseconds resets the partial sequence', () => {
  const sequence = gate();
  sequence.push('c', 0);
  sequence.push('h', 100);
  sequence.push('e', 1701);
  for (const [index, key] of Array.from('at').entries()) sequence.push(key, 1800 + index * 100);
  assert.equal(sequence.isUnlocked(), false);
  for (const [index, key] of Array.from('cheat').entries()) sequence.push(key, 3000 + index * 100);
  assert.equal(sequence.isUnlocked(), true);
});

test('unlock is reported once and remains for the session; a new gate starts locked', () => {
  const sequence = gate();
  let completions = 0;
  for (const [index, key] of Array.from('cheat').entries()) {
    if (sequence.push(key, index * 100)) completions++;
  }
  for (const [index, key] of Array.from('cheat').entries()) {
    if (sequence.push(key, 1000 + index * 100)) completions++;
  }
  assert.equal(completions, 1);
  assert.equal(sequence.isUnlocked(), true);
  assert.equal(gate().isUnlocked(), false);
});

test('modifier combinations, IME composition, and non-character keys do not advance the sequence', () => {
  const sequence = gate();
  assert.equal(sequence.push('Control', 0), false);
  assert.equal(sequence.push('c', 10, { ctrlKey: true }), false);
  assert.equal(sequence.push('c', 20, { isComposing: true }), false);
  assert.equal(sequence.push('h', 30), false);
  assert.equal(sequence.isUnlocked(), false);
});

test('the former sequence does not unlock the renamed gate', () => {
  const sequence = gate();
  for (const [index, key] of Array.from('keynesy').entries()) sequence.push(key, index * 100);
  assert.equal(sequence.isUnlocked(), false);
});
