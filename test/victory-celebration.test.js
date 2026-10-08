const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.existsSync('js/victory-celebration.js')
  ? fs.readFileSync('js/victory-celebration.js', 'utf8') : '';
const html = fs.readFileSync('index.html', 'utf8');
const ui = fs.readFileSync('js/ui.js', 'utf8');
const css = fs.readFileSync('css/style.css', 'utf8');

function fixture({ random = Math.random } = {}) {
  let nextFrame = 1;
  let nextInterval = 1;
  const frames = new Map();
  const intervals = new Map();
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
  const math = Object.create(Math);
  math.random = random;
  const context = {
    window,
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setInterval(callback, delay) { const id = nextInterval++; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    Math: math,
  };
  vm.runInNewContext(source, context);
  const create = context.window.MineVictoryCelebration?.create;
  assert.equal(typeof create, 'function', 'victory celebration module is available');
  const celebration = create(canvas, message);
  return {
    canvas, message, celebration, operations, frames, intervals,
    tick(timestamp) {
      const [id, callback] = frames.entries().next().value || [];
      assert.ok(callback, 'an animation frame is pending');
      frames.delete(id);
      callback(timestamp);
    },
    tickInterval() {
      const interval = intervals.values().next().value;
      assert.ok(interval, 'a periodic firework burst is scheduled');
      interval.callback();
    },
  };
}

test('victory keeps the winner visible and schedules new fireworks without an idle animation loop', () => {
  const { canvas, message, celebration, operations, frames, intervals, tick, tickInterval } = fixture();

  celebration.start('蓝方获胜！');
  assert.equal(message.textContent, '蓝方获胜！');
  assert.equal(message.classList.contains('show'), true);
  assert.equal(canvas.classList.contains('show'), true);
  assert.equal(canvas.width, 1000);
  assert.equal(canvas.height, 700);

  let timestamp = 0;
  while (frames.size && timestamp < 2000) {
    tick(timestamp);
    timestamp += 16;
  }
  assert.equal(frames.size, 0, 'animation frames stop after the current particles expire');
  assert.equal(intervals.size, 1, 'a low-frequency timer keeps future bursts scheduled');
  assert.equal(message.classList.contains('show'), true);
  assert.equal(canvas.classList.contains('show'), true);

  tickInterval();
  assert.equal(frames.size, 1, 'a new burst restarts drawing');
  tick(timestamp);
  assert.equal(message.classList.contains('show'), true);
  assert.equal(canvas.classList.contains('show'), true);
  assert.ok(operations.some(([operation]) => operation === 'arc'), 'firework particles were drawn');

  celebration.stop();
  assert.equal(frames.size, 0);
  assert.equal(intervals.size, 0);
});

test('firework bursts do not accumulate stale particles while animation frames are paused', () => {
  const { celebration, tick, tickInterval, operations } = fixture();

  celebration.start('蓝方获胜！');
  for (let i = 0; i < 20; i++) tickInterval();
  tick(0);

  const drawnParticles = operations.filter(([operation]) => operation === 'arc').length;
  assert.equal(drawnParticles, 30, 'only the latest burst is retained while frames are paused');
  celebration.stop();
});

test('initial firework bursts originate near the screen center instead of the edges', () => {
  const { celebration, operations, tick } = fixture({ random: () => 0.5 });

  celebration.start('蓝方获胜！');
  tick(0);
  const points = operations.filter(([operation]) => operation === 'arc');
  assert.equal(points.length, 30);
  for (const [, x, y] of points) {
    assert.ok(x > 250 && x < 750, `burst x=${x} should stay in the center region`);
    assert.ok(y > 150 && y < 550, `burst y=${y} should stay in the center region`);
  }
  celebration.stop();
});

test('starting a new celebration replaces the active one and stop cleans it up', () => {
  const { canvas, message, celebration, frames, intervals } = fixture();

  celebration.start('蓝方获胜！');
  const firstFrame = frames.keys().next().value;
  const firstInterval = intervals.keys().next().value;
  celebration.start('红方获胜！');
  assert.equal(message.textContent, '红方获胜！');
  assert.equal(frames.size, 1);
  assert.equal(intervals.size, 1);
  assert.equal(frames.has(firstFrame), false);
  assert.equal(intervals.has(firstInterval), false);

  celebration.stop();
  assert.equal(frames.size, 0);
  assert.equal(intervals.size, 0);
  assert.equal(canvas.classList.contains('show'), false);
  assert.equal(message.classList.contains('show'), false);
});

test('game victory starts the named celebration while new-game dialog is centered responsively', () => {
  const onGameOver = ui.match(/function onGameOver\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(html, /<canvas id="victoryFireworks"/);
  assert.match(html, /id="winnerMessage"[^>]*aria-live="assertive"/);
  assert.match(onGameOver, /victoryCelebration\.start\(game\.winner === 'draw' \? '本局平局' : label\(game\.winner\) \+ '获胜！'\)/);
  assert.match(onGameOver, /game\.winner === 'draw'/);
  assert.match(css, /dialog\s*\{[^}]*position:\s*fixed;[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*transform:\s*translate\(-50%,\s*-50%\)/);
  assert.match(css, /dialog\s*\{[^}]*max-height:\s*92vh;[^}]*overflow-y:\s*auto;/);
  assert.match(css, /#victoryFireworks\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*pointer-events:\s*none;/);
});
