'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runTournament, summarizeTournament } = require('./ai-tournament-stats');

const UINT32_MAX = 0xffffffff;
const DEFAULTS = {
  opponent: 'heuristic',
  seedCount: 100,
  split: 'dev',
  traceDir: null,
  includeHiddenMap: false,
  output: null,
  help: false,
};
const SPLIT_SEED_START = {
  dev: 100000,
  validation: 1000000000,
};
const OPPONENT_IDS = ['heuristic', 'global-probability'];
const HELP_TEXT = `Usage: node scripts/ai-tournament.js [options]

Options:
  --opponent heuristic|global-probability|both  Opponent baseline (default: heuristic)
  --seed-start N                                First unsigned 32-bit seed
  --seed-count N                                Number of consecutive seeds (default: 100)
  --split dev|validation                        Seed split (default: dev)
  --trace-dir PATH                              Write one public JSONL trace per opponent
  --include-hidden-map                          Write separate post-game hidden-map JSONL files
  --output PATH                                 Write the machine-readable JSON summary
  --help                                        Show this help

Default seed starts: dev 100000; validation 1000000000.
`;

function parseInteger(value, flag) {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} requires a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${flag} must be a safe integer`);
  return parsed;
}

function validateOptions(options) {
  if (!['heuristic', 'global-probability', 'both'].includes(options.opponent)) {
    throw new Error(`Invalid opponent: ${options.opponent}`);
  }
  if (!Object.hasOwn(SPLIT_SEED_START, options.split)) {
    throw new Error(`Invalid split: ${options.split}`);
  }
  if (!Number.isInteger(options.seedStart) || options.seedStart < 0 || options.seedStart > UINT32_MAX) {
    throw new Error('--seed-start must be an unsigned 32-bit integer');
  }
  if (!Number.isSafeInteger(options.seedCount) || options.seedCount <= 0) {
    throw new Error('--seed-count must be a positive integer');
  }
  if (options.seedStart + options.seedCount - 1 > UINT32_MAX) {
    throw new Error('Seed range exceeds unsigned 32-bit integers');
  }
  if (options.traceDir !== null && (typeof options.traceDir !== 'string' || options.traceDir.trim() === '')) {
    throw new Error('--trace-dir requires a non-empty path');
  }
  if (options.output !== null && (typeof options.output !== 'string' || options.output.trim() === '')) {
    throw new Error('--output requires a non-empty path');
  }
  if (options.includeHiddenMap && !options.traceDir) {
    throw new Error('--include-hidden-map requires --trace-dir');
  }
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  let seedStartWasSpecified = false;

  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help') return { ...options, help: true };

    const valueFor = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} requires a value`);
      }
      index++;
      return value;
    };

    switch (flag) {
      case '--opponent':
        options.opponent = valueFor();
        if (!['heuristic', 'global-probability', 'both'].includes(options.opponent)) {
          throw new Error(`Invalid --opponent value: ${options.opponent}`);
        }
        break;
      case '--seed-start':
        options.seedStart = parseInteger(valueFor(), flag);
        seedStartWasSpecified = true;
        if (options.seedStart > UINT32_MAX) throw new Error('--seed-start must be an unsigned 32-bit integer');
        break;
      case '--seed-count':
        options.seedCount = parseInteger(valueFor(), flag);
        if (options.seedCount === 0) throw new Error('--seed-count must be a positive integer');
        break;
      case '--split':
        options.split = valueFor();
        if (!Object.hasOwn(SPLIT_SEED_START, options.split)) {
          throw new Error(`Invalid --split value: ${options.split}`);
        }
        break;
      case '--trace-dir':
        options.traceDir = valueFor();
        if (options.traceDir.trim() === '') throw new Error('--trace-dir requires a non-empty path');
        break;
      case '--include-hidden-map':
        options.includeHiddenMap = true;
        break;
      case '--output':
        options.output = valueFor();
        if (options.output.trim() === '') throw new Error('--output requires a non-empty path');
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (!seedStartWasSpecified) options.seedStart = SPLIT_SEED_START[options.split];
  validateOptions(options);
  return options;
}

function publicGameResult(game) {
  const { trace, hiddenMap, ...result } = game;
  return result;
}

function writeJsonLines(filename, records) {
  const contents = records.map(record => JSON.stringify(record)).join('\n');
  fs.writeFileSync(filename, contents ? `${contents}\n` : '', 'utf8');
}

function opponentIds(opponent) {
  return opponent === 'both' ? OPPONENT_IDS : [opponent];
}

function runCli(options) {
  if (options.help) return { help: HELP_TEXT };
  validateOptions(options);

  const report = {
    split: options.split,
    seedStart: options.seedStart,
    seedCount: options.seedCount,
    config: { width: 15, height: 15, mineCount: 53, bombCount: 1 },
    opponents: {},
  };
  if (options.traceDir) fs.mkdirSync(options.traceDir, { recursive: true });

  for (const opponentId of opponentIds(options.opponent)) {
    const tournament = runTournament({
      opponentId,
      seedStart: options.seedStart,
      seedCount: options.seedCount,
      ...report.config,
      includeTrace: Boolean(options.traceDir),
      includeHiddenMap: options.includeHiddenMap,
    });

    const result = {
      seedClusters: tournament.seedClusters.map(cluster => ({
        seed: cluster.seed,
        mapHash: cluster.mapHash,
        games: cluster.games.map(publicGameResult),
      })),
    };
    if (tournament.incomplete) {
      result.incomplete = {
        ...tournament.incomplete,
        successfulPartialGames: tournament.incomplete.successfulPartialGames.map(publicGameResult),
      };
    } else {
      result.summary = summarizeTournament(tournament.seedClusters, {
        bootstrapSeed: options.seedStart,
      });
    }
    report.opponents[opponentId] = result;

    if (options.traceDir) {
      const safeId = opponentId.replace(/[^a-z0-9-]/gi, '-');
      const tracePath = path.join(options.traceDir, `${safeId}.jsonl`);
      const traces = tournament.matches.map(game => {
        const { hiddenMap, ...publicResult } = game;
        return publicResult;
      });
      writeJsonLines(tracePath, traces);

      if (options.includeHiddenMap) {
        const hiddenMapPath = path.join(options.traceDir, `${safeId}-hidden-maps.jsonl`);
        const hiddenMaps = tournament.matches.map(game => ({
          seed: game.seed,
          invincibleSide: game.invincibleSide,
          opponentId: game.opponentId,
          hiddenMap: game.hiddenMap,
        }));
        writeJsonLines(hiddenMapPath, hiddenMaps);
      }
    }
  }

  if (Object.values(report.opponents).some(result => result.incomplete)) report.incomplete = true;
  if (options.output) {
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return report;
}

function consoleReport(report) {
  if (report.help) return report.help;
  return {
    split: report.split,
    seedStart: report.seedStart,
    seedCount: report.seedCount,
    opponents: Object.fromEntries(Object.entries(report.opponents).map(([id, result]) => [
      id,
      result.incomplete ? { incomplete: result.incomplete } : result.summary,
    ])),
    ...(report.incomplete ? { incomplete: true } : {}),
  };
}

if (require.main === module) {
  try {
    const result = runCli(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${typeof result.help === 'string'
      ? result.help
      : `${JSON.stringify(consoleReport(result), null, 2)}\n`}`);
    if (result.incomplete) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, runCli };
