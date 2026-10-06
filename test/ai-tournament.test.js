const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSeededCrypto, createRuntime } = require('../scripts/ai-tournament-runtime');
const { runTournament, summarizeTournament } = require('../scripts/ai-tournament-stats');
const { parseArgs, runCli } = require('../scripts/ai-tournament');

test('parseArgs normalizes tournament options and uses disjoint split defaults', () => {
  assert.deepEqual(parseArgs([
    '--opponent', 'both',
    '--seed-start', '10',
    '--seed-count', '20',
    '--split', 'validation',
  ]), {
    opponent: 'both',
    seedStart: 10,
    seedCount: 20,
    split: 'validation',
    traceDir: null,
    includeHiddenMap: false,
    output: null,
    help: false,
  });
  assert.equal(parseArgs([]).seedStart, 100000);
  assert.equal(parseArgs(['--split', 'validation']).seedStart, 1000000000);
  assert.equal(parseArgs(['--seed-start', '7', '--split', 'validation']).seedStart, 7);
});

test('parseArgs rejects invalid or incomplete options with readable errors', () => {
  const invalidArguments = [
    ['--seed-count', '0'],
    ['--seed-start', '4294967296'],
    ['--opponent', 'unknown'],
    ['--seed-count'],
    ['--unknown'],
    ['--include-hidden-map'],
    ['--seed-start', '4294967295', '--seed-count', '2'],
  ];
  for (const args of invalidArguments) {
    assert.throws(() => parseArgs(args), Error, `arguments should be rejected: ${args.join(' ')}`);
  }
});

test('--help returns usage without launching a tournament', () => {
  const options = parseArgs(['--help']);
  assert.equal(options.help, true);
  const result = runCli(options);
  assert.ok(result.help.includes('Usage: node scripts/ai-tournament.js'));
});

test('runCli writes aggregate JSON, public traces, and separate post-game hidden maps', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minestorm-tournament-'));
  const traceDir = path.join(directory, 'traces');
  const output = path.join(directory, 'reports', 'summary.json');
  try {
    const report = runCli(parseArgs([
      '--opponent', 'heuristic',
      '--seed-start', '42',
      '--seed-count', '1',
      '--trace-dir', traceDir,
      '--include-hidden-map',
      '--output', output,
    ]));
    assert.equal(report.seedStart, 42);
    assert.equal(report.seedCount, 1);
    assert.deepEqual(report.config, { width: 15, height: 15, mineCount: 53, bombCount: 1 });
    assert.equal(report.opponents.heuristic.summary.games, 2);
    assert.equal(report.opponents.heuristic.seedClusters.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), report);

    const traces = fs.readFileSync(path.join(traceDir, 'heuristic.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line));
    const hiddenMaps = fs.readFileSync(path.join(traceDir, 'heuristic-hidden-maps.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line));
    assert.equal(traces.length, 2);
    assert.equal(hiddenMaps.length, 2);
    for (const trace of traces) {
      assert.ok(Array.isArray(trace.trace));
      assert.equal(Object.hasOwn(trace, 'hiddenMap'), false);
      assert.ok(trace.trace.every(entry => Object.hasOwn(entry, 'view') && !Object.hasOwn(entry, 'hiddenMap')));
    }
    for (const hiddenMap of hiddenMaps) {
      assert.equal(hiddenMap.hiddenMap.length, 225);
      assert.equal(hiddenMap.hiddenMap.reduce((count, mine) => count + mine, 0), 53);
    }
    assert.equal(traces[0].mapHash, traces[1].mapHash);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('seeded crypto fills deterministic words and continues its sequence', () => {
  const first = createSeededCrypto(12345);
  const second = createSeededCrypto(12345);
  const firstWords = new Uint32Array(8);
  const secondWords = new Uint32Array(8);

  assert.equal(first.getRandomValues(firstWords), firstWords);
  second.getRandomValues(secondWords);
  assert.deepEqual(firstWords, secondWords);

  const nextWords = new Uint32Array(8);
  const restartedWords = new Uint32Array(8);
  first.getRandomValues(nextWords);
  createSeededCrypto(12345).getRandomValues(restartedWords);
  assert.notDeepEqual(nextWords, restartedWords);

  const zeroSeedWords = new Uint32Array(8);
  createSeededCrypto(0).getRandomValues(zeroSeedWords);
  assert.ok(zeroSeedWords.some(word => word !== 0), 'zero seed must normalize to nonzero state');
});

test('runtime map generation and decision functions are deterministic and available', () => {
  const first = createRuntime(12345);
  const second = createRuntime(12345);
  const config = { width: 7, height: 7, mineCount: 9, bombCount: 1 };
  const firstGame = new first.core.MineCore.Game(config);
  const secondGame = new second.core.MineCore.Game(config);

  assert.deepEqual(Array.from(firstGame.mines), Array.from(secondGame.mines));
  for (const id of ['heuristic', 'global-probability', 'constraint-probability']) {
    assert.equal(typeof first.decisions[id], 'function', `${id} decision is callable`);
    assert.equal(typeof second.decisions[id], 'function', `${id} decision is callable`);
  }
});

test('different seeds produce different deterministic random sequences', () => {
  const firstWords = new Uint32Array(8);
  const secondWords = new Uint32Array(8);
  createSeededCrypto(12345).getRandomValues(firstWords);
  createSeededCrypto(54321).getRandomValues(secondWords);

  assert.notDeepEqual(firstWords, secondWords);
});

test('runMatch completes a deterministic official-rule match', () => {
  const { runMatch } = require('../scripts/ai-tournament-runtime');
  const options = {
    seed: 12345,
    invincibleSide: 'blue',
    opponentId: 'heuristic',
    width: 7,
    height: 7,
    mineCount: 9,
    bombCount: 1,
  };
  const first = runMatch(options);
  const second = runMatch(options);

  assert.equal(first.winner, second.winner);
  assert.deepEqual(first.scores, second.scores);
  assert.equal(first.moveCount, second.moveCount);
  assert.equal(first.mapHash, second.mapHash);
  assert.ok(first.moveCount <= options.width * options.height + 1);
  assert.equal(first.scoreMargin, first.scores.blue - first.scores.red);
  assert.ok(first.bombsUsed >= 0 && first.bombsUsed <= options.bombCount);
  assert.ok(['blue', 'red', 'draw'].includes(first.winner));
  assert.equal(first.trace, undefined);
  assert.equal(Object.hasOwn(first, 'hiddenMap'), false);
});

test('runTournament pairs both Invincible seats on the same seeded map', () => {
  const tournament = runTournament({
    opponentId: 'heuristic',
    seedStart: 12345,
    seedCount: 1,
    width: 7,
    height: 7,
    mineCount: 9,
    bombCount: 1,
  });

  assert.equal(tournament.opponentId, 'heuristic');
  assert.equal(tournament.seedStart, 12345);
  assert.equal(tournament.seedCount, 1);
  assert.equal(tournament.matches.length, 2);
  assert.equal(tournament.seedClusters.length, 1);
  const [blueSeatResult, redSeatResult] = tournament.seedClusters[0].games;
  assert.deepEqual(
    [blueSeatResult.invincibleSide, redSeatResult.invincibleSide].sort(),
    ['blue', 'red'],
  );
  assert.equal(blueSeatResult.mapHash, redSeatResult.mapHash);
  assert.equal(tournament.seedClusters[0].mapHash, blueSeatResult.mapHash);
  assert.ok(tournament.matches.every(match => match.seed === 12345));
});

test('runTournament returns an incomplete result without a win-rate conclusion on match errors', () => {
  const tournament = runTournament({
    opponentId: 'heuristic',
    seedStart: 12345,
    seedCount: 1,
    width: -1,
    height: 7,
    mineCount: 9,
    bombCount: 1,
  });

  assert.equal(tournament.seedClusters.length, 0);
  assert.equal(tournament.matches.length, 0);
  assert.equal(tournament.incomplete.failedSeed, 12345);
  assert.equal(tournament.incomplete.failedSeat, 'blue');
  assert.equal(tournament.incomplete.errorCount, 1);
  assert.match(tournament.incomplete.error, /.+/);
  assert.deepEqual(tournament.incomplete.successfulPartialGames, []);
  assert.equal(Object.hasOwn(tournament, 'winRate'), false);
});

test('summarizeTournament reports paired outcomes and reproducible cluster bootstrap intervals', () => {
  function game(invincibleSide, invincibleOutcome, scoreMargin, bombsUsed) {
    const winner = invincibleOutcome === 'draw'
      ? 'draw'
      : invincibleOutcome === 'win'
        ? invincibleSide
        : invincibleSide === 'blue' ? 'red' : 'blue';
    return { invincibleSide, winner, scoreMargin, bombsUsed };
  }
  const seedClusters = [
    { seed: 1, mapHash: 'map-1', games: [game('blue', 'win', 2, 1), game('red', 'win', 4, 0)] },
    { seed: 2, mapHash: 'map-2', games: [game('blue', 'win', 6, 1), game('red', 'draw', 0, 1)] },
    { seed: 3, mapHash: 'map-3', games: [game('blue', 'loss', -2, 0), game('red', 'loss', -4, 0)] },
    { seed: 4, mapHash: 'map-4', games: [game('blue', 'draw', 0, 1), game('red', 'loss', -6, 0)] },
  ];

  const first = summarizeTournament(seedClusters, { bootstrapSeed: 7654, bootstrapReplicates: 500 });
  const second = summarizeTournament(seedClusters, { bootstrapSeed: 7654, bootstrapReplicates: 500 });

  assert.equal(first.games, 8);
  assert.equal(first.wins, 3);
  assert.equal(first.draws, 2);
  assert.equal(first.losses, 3);
  assert.equal(first.winRate, 0.5);
  assert.equal(first.averageScoreMargin, 0);
  assert.equal(first.bombUseRate, 0.5);
  assert.equal(first.errors, 0);
  assert.deepEqual(first.confidence95, second.confidence95);
  assert.ok(first.confidence95.lower >= 0 && first.confidence95.lower <= 1);
  assert.ok(first.confidence95.upper >= 0 && first.confidence95.upper <= 1);
  assert.ok(first.confidence95.lower <= first.confidence95.upper);
});

test('runMatch traces public inputs and only attaches hidden map after completion', () => {
  const { runMatch } = require('../scripts/ai-tournament-runtime');
  const result = runMatch({
    seed: 54321,
    invincibleSide: 'red',
    opponentId: 'global-probability',
    width: 7,
    height: 7,
    mineCount: 9,
    bombCount: 1,
    includeTrace: true,
    includeHiddenMap: true,
  });

  assert.equal(result.trace.length, result.moveCount);
  assert.equal(result.hiddenMap.length, 49);
  assert.equal(result.hiddenMap.reduce((count, mine) => count + mine, 0), 9);
  for (const entry of result.trace) {
    assert.equal(Object.hasOwn(entry.view, 'mines'), false);
    assert.equal(Object.hasOwn(entry.view, 'mapHash'), false);
    assert.equal(Object.hasOwn(entry, 'hiddenMap'), false);
    assert.equal(entry.view.cells.length, 49);
    assert.deepEqual(Object.keys(entry.scoresBefore).sort(), ['blue', 'red']);
    assert.deepEqual(Object.keys(entry.bombsBefore).sort(), ['blue', 'red']);
    assert.ok(Array.isArray(entry.revealedCells));
  }
});
