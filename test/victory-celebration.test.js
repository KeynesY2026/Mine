const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.existsSync('js/victory-celebration.js')
  ? fs.readFileSync('js/victory-celebration.js', 'utf8') : '';
const html = fs.readFileSync('index.html', 'utf8');
const ui = fs.readFileSync('js/ui.js', 'utf8');
const css = fs.readFileSync('css/style.css', 'utf8');

function fixture() {
  let nextFrame = 1;
  const frames = new Map();
  const operations = [];
  const context2d = new Proxy({}, {
    get: (_, key) => (...args) => operations.push([key, ...args]),
    set: (_, key, value) => { operations.push([key, value]); return true; },
  });
  const canvas = {
    width: 0, height: 0,
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
    },
    getContext: () => context2d,
  };
  const message = {
    textContent: '',
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
    },
  };
  const window = { innerWidth: 1000, innerHeight: 700, devicePixelRatio: 1 };
  const context = {
    window,
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    Math,
  };
  vm.runInNewContext(source, context);
  const create = context.window.MineVictoryCelebration?.create;
  assert.equal(typeof create, 'function', 'victory celebration module is available');
  const celebration = create(canvas, message);
  return {
    canvas, message, celebration, operations, frames,
    tick(timestamp) {
      const [id, callback] = frames.entries().next().value || [];
      assert.ok(callback, 'an animation frame is pending');
      frames.delete(id);
      callback(timestamp);
    },
  };
}

test('victory celebration announces the winner and animates for 2.5 seconds', () => {
  const { canvas, message, celebration, operations, frames, tick } = fixture();

  celebration.start('蓝方获胜！');
  assert.equal(message.textContent, '蓝方获胜！');
  assert.equal(message.classList.contains('show'), true);
  assert.equal(canvas.classList.contains('show'), true);
  assert.equal(canvas.width, 1000);
  assert.equal(canvas.height, 700);

  tick(0);
  tick(2400);
  assert.equal(message.classList.contains('show'), true);
  tick(2500);
  assert.equal(message.classList.contains('show'), false);
  assert.equal(canvas.classList.contains('show'), false);
  assert.equal(frames.size, 0);
  assert.ok(operations.some(([operation]) => operation === 'arc'), 'firework particles were drawn');
});

test('starting a new celebration replaces the active one and stop cleans it up', () => {
  const { canvas, message, celebration, frames } = fixture();

  celebration.start('蓝方获胜！');
  const firstFrame = frames.keys().next().value;
  celebration.start('红方获胜！');
  assert.equal(message.textContent, '红方获胜！');
  assert.equal(frames.size, 1);
  assert.equal(frames.has(firstFrame), false);

  celebration.stop();
  assert.equal(frames.size, 0);
  assert.equal(canvas.classList.contains('show'), false);
  assert.equal(message.classList.contains('show'), false);
});

test('game victory starts the named celebration while new-game dialog is centered responsively', () => {
  const onGameOver = ui.match(/function onGameOver\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(html, /<canvas id="victoryFireworks"/);
  assert.match(html, /id="winnerMessage"[^>]*aria-live="assertive"/);
  assert.match(onGameOver, /victoryCelebration\.start\(label\(game\.winner\) \+ '获胜！'\)/);
  assert.match(onGameOver, /game\.winner === 'draw'/);
  assert.match(css, /dialog\s*\{[^}]*position:\s*fixed;[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*transform:\s*translate\(-50%,\s*-50%\)/);
  assert.match(css, /dialog\s*\{[^}]*max-height:\s*92vh;[^}]*overflow-y:\s*auto;/);
  assert.match(css, /#victoryFireworks\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*pointer-events:\s*none;/);
});
