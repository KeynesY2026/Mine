const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.existsSync('js/diagnostic-log.js') ? fs.readFileSync('js/diagnostic-log.js', 'utf8') : '';
const context = { window: {} };
vm.runInNewContext(source, context);
const diagnosticLog = context.window.MineDiagnosticLog;

function gameView(overrides = {}) {
  const cells = [-2, 0, -2, -2, -1, 2];
  return {
    width: 3,
    height: 2,
    score: 0,
    oppScore: 1,
    mineCount: 3,
    remainMines: 2,
    bombs: 1,
    canBomb: true,
    turn: 'blue',
    cellAt(x, y) { return cells[y * 3 + x]; },
    analysis: {
      quality: 'exact',
      error: null,
      hiddenCells: [0, 2, 3],
      frontierCells: [0, 2],
      freeCells: [3],
      bombCenters: [
        { x: 0, y: 0, expectedMines: 1.5, hiddenCount: 3, uniformHitCountProbabilities: [0, 0.5, 0.5, 0] },
        { x: 2, y: 0, expectedMines: 0.5, hiddenCount: 2, uniformHitCountProbabilities: null },
      ],
    },
    ...overrides,
  };
}

test('export session preserves settings and the actual map as rows for forensic review', () => {
  assert.equal(typeof diagnosticLog?.createGameLog, 'function');
  const session = diagnosticLog.createGameLog({
    startedAt: '2026-10-07T12:00:00.000Z',
    width: 2,
    height: 2,
    settings: { mineCount: 1, bombCount: 1, disableAiBombs: false },
    aiBySide: { blue: 'constraint-probability', red: 'heuristic' },
    actualMineMap: [0, 1, 0, 0],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(session)), {
    schemaVersion: 1,
    startedAt: '2026-10-07T12:00:00.000Z',
    settings: { width: 2, height: 2, mineCount: 1, bombCount: 1, disableAiBombs: false },
    aiBySide: { blue: 'constraint-probability', red: 'heuristic' },
    actualMineMap: [[0, 1], [0, 0]],
    moves: [],
  });
});

test('decision snapshot records public board, win-line requirement, and exact per-center forecasts', () => {
  assert.equal(typeof diagnosticLog?.captureView, 'function');
  const snapshot = diagnosticLog.captureView(gameView(), 0.5);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    player: 'blue',
    score: 0,
    oppScore: 1,
    mineCount: 3,
    remainMines: 2,
    bombs: 1,
    canBomb: true,
    threshold: 0.5,
    winNeed: 2,
    neededHits: 2,
    publicBoard: [[-2, 0, -2], [-2, -1, 2]],
    analysis: {
      quality: 'exact',
      error: null,
      hiddenCount: 3,
      frontierCount: 2,
      freeCount: 1,
      bombCandidates: [
        { x: 0, y: 0, hiddenCount: 3, expectedMines: 1.5, directWinProbability: 0.5, directWinProbabilityModel: 'uniform-valid-layouts', uniformHitCountProbabilities: [0, 0.5, 0.5, 0] },
        { x: 2, y: 0, hiddenCount: 2, expectedMines: 0.5, directWinProbability: null, directWinProbabilityModel: null, uniformHitCountProbabilities: null },
      ],
    },
  });
});

test('approximate analyses never claim a direct-win probability', () => {
  const snapshot = diagnosticLog.captureView(gameView({ analysis: {
    quality: 'approximate', error: 'search limit exceeded', hiddenCells: [0, 2, 3],
    frontierCells: [0, 2], freeCells: [3],
    bombCenters: [{ x: 0, y: 0, hiddenCount: 3, expectedMines: 1, uniformHitCountProbabilities: null }],
  } }), 0.5);
  assert.equal(snapshot.analysis.quality, 'approximate');
  assert.equal(snapshot.analysis.error, 'search limit exceeded');
  assert.equal(snapshot.analysis.bombCandidates[0].directWinProbability, null);
});

test('move and export records retain requested versus executed action and resolution details', () => {
  const session = diagnosticLog.createGameLog({
    startedAt: 'start', width: 3, height: 2, settings: { mineCount: 3 },
    aiBySide: { blue: 'constraint-probability', red: 'human' }, actualMineMap: [0, 1, 0, 1, 0, 0],
  });
  const before = diagnosticLog.captureView(gameView(), 0.5);
  diagnosticLog.recordMove(session, {
    player: 'blue', agent: 'constraint-probability', before,
    requestedAction: { type: 'open', x: 1, y: 0 },
    executedAction: { type: 'bomb', x: 0, y: 0 },
    invalid: true, decisionSourceFailed: false,
    result: { ok: true, kind: 'bomb', x: 0, y: 0, mines: 2, cells: [0, 1, 3] },
    after: { scores: { blue: 2, red: 1 }, bombs: { blue: 0, red: 1 }, turn: 'red', remainMines: 1, over: false, winner: null },
  });
  const cyclicDecision = {};
  cyclicDecision.self = cyclicDecision;
  diagnosticLog.recordMove(session, {
    player: 'red', agent: 'heuristic', before,
    requestedAction: cyclicDecision, executedAction: { type: 'open', x: 1, y: 1 },
    result: { ok: true, kind: 'number', x: 1, y: 1 },
    after: { scores: { blue: 2, red: 1 }, bombs: { blue: 0, red: 1 }, turn: 'blue', remainMines: 1, over: false, winner: null },
  });
  const document = diagnosticLog.createExportDocument(session,
    { scores: { blue: 2, red: 1 }, bombs: { blue: 0, red: 1 }, turn: 'red', over: false, winner: null },
    'exported');
  assert.equal(document.moves.length, 2);
  assert.equal(document.moves[0].index, 1);
  assert.equal(document.moves[0].agent, 'constraint-probability');
  assert.equal(document.moves[0].fallbackAgent, null);
  assert.equal(document.moves[1].index, 2);
  assert.equal(document.moves[1].agent, 'heuristic');
  assert.equal(document.moves[1].decision.requestedAction.self, '[Circular]');
  assert.deepEqual(JSON.parse(JSON.stringify(document.moves[0].decision)), {
    requestedAction: { type: 'open', x: 1, y: 0 },
    executedAction: { type: 'bomb', x: 0, y: 0 },
    invalid: true,
    decisionSourceFailed: false,
    error: null,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(document.moves[0].result)), { ok: true, why: null, kind: 'bomb', x: 0, y: 0, mines: 2, cells: [0, 1, 3] });
  assert.equal(document.finalState.turn, 'red');
  assert.equal(document.exportedAt, 'exported');
  assert.equal(session.moves.length, 2);
  assert.doesNotThrow(() => JSON.stringify(document));
});
