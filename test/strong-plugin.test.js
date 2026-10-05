const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.existsSync('plugin/ai-constraint-probability.js')
  ? fs.readFileSync('plugin/ai-constraint-probability.js', 'utf8')
  : '';
let makeDecision = null;
const sandbox = {
  window: {
    MineAIPlugins: {
      register(id, decide) {
        assert.equal(id, 'constraint-probability');
        makeDecision = decide;
      },
    },
  },
};
vm.runInNewContext(source, sandbox);

function decide(board) {
  assert.equal(typeof makeDecision, 'function', 'standalone plugin registers makeDecision(view)');
  return JSON.parse(JSON.stringify(makeDecision(board)));
}

function view(width, height, cells, overrides = {}) {
  return {
    width,
    height,
    score: 0,
    oppScore: 0,
    mineCount: 1,
    remainMines: 1,
    bombs: 1,
    canBomb: false,
    bombRadiusH: 0,
    bombRadiusV: 0,
    turn: 'blue',
    cellAt(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return -2;
      return cells[y * width + x];
    },
    ...overrides,
  };
}

test('strong plugin pursues a possible mine instead of a cell proven safe by a zero', () => {
  const board = view(3, 2, [0, -2, -2, -2, -2, -2]);

  assert.deepEqual(decide(board), { type: 'open', x: 2, y: 0 });
});

test('strong plugin chooses the highest mine probability over a lower-risk constrained cell', () => {
  const board = view(3, 2, [-2, -2, 1, -2, -2, -2], {
    mineCount: 4,
    remainMines: 2,
  });

  assert.deepEqual(decide(board), { type: 'open', x: 0, y: 0 });
});

test('strong plugin prefers an information-rich center when every hidden cell has equal probability', () => {
  const board = view(5, 5, Array(25).fill(-2), {
    mineCount: 5,
    remainMines: 5,
  });

  assert.deepEqual(decide(board), { type: 'open', x: 2, y: 2 });
});

test('strong plugin bombs the legal area with the highest expected mine yield', () => {
  const board = view(5, 1, Array(5).fill(-2), {
    mineCount: 5,
    remainMines: 3,
    oppScore: 2,
    bombs: 2,
    canBomb: true,
    bombRadiusH: 1,
    bombRadiusV: 0,
  });

  assert.deepEqual(decide(board), { type: 'bomb', x: 1, y: 0 });
});

test('strong plugin never bombs when the view says bombing is unavailable', () => {
  const board = view(5, 1, Array(5).fill(-2), {
    mineCount: 5,
    remainMines: 3,
    oppScore: 2,
    canBomb: false,
    bombRadiusH: 1,
    bombRadiusV: 0,
  });

  assert.deepEqual(decide(board), { type: 'open', x: 2, y: 0 });
});

test('strong plugin does not waste its last bomb on a non-winning expected yield', () => {
  const board = view(5, 1, Array(5).fill(-2), {
    mineCount: 3,
    remainMines: 2,
    bombs: 1,
    canBomb: true,
    bombRadiusH: 1,
    bombRadiusV: 0,
    score: 0,
    oppScore: 0,
  });

  assert.deepEqual(decide(board), { type: 'open', x: 2, y: 0 });
  assert.equal('mines' in board, false);
});

test('strong plugin uses its last bomb when expected yield reaches the win line', () => {
  const board = view(1, 1, [-2], {
    mineCount: 1,
    remainMines: 1,
    bombs: 1,
    canBomb: true,
    bombRadiusH: 0,
    bombRadiusV: 0,
    score: 0,
    oppScore: 0,
  });

  assert.deepEqual(decide(board), { type: 'bomb', x: 0, y: 0 });
});

test('strong plugin opens instead of bombing when its inventory is empty', () => {
  const board = view(5, 1, Array(5).fill(-2), {
    mineCount: 5,
    remainMines: 3,
    oppScore: 2,
    bombs: 0,
    canBomb: true,
    bombRadiusH: 1,
    bombRadiusV: 0,
  });

  assert.deepEqual(decide(board), { type: 'open', x: 2, y: 0 });
});
