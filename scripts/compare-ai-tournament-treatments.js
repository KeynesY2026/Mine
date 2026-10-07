'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { seededWordGenerator, summarizeBombForecastCalibration } = require('./ai-tournament-stats');

const UINT32_MAX = 0xffffffff;
const DEFAULT_BOOTSTRAP_REPLICATES = 20000;

function reportsFromInput(input) {
  if (typeof input !== 'string') return Array.isArray(input) ? input : [input];
  const resolved = path.resolve(input);
  const stat = fs.statSync(resolved);
  const filenames = stat.isDirectory()
    ? fs.readdirSync(resolved).filter(name => name.endsWith('.json')).sort().map(name => path.join(resolved, name))
    : [resolved];
  if (filenames.length === 0) throw new Error(`No JSON tournament reports found in ${resolved}`);
  return filenames.map(filename => JSON.parse(fs.readFileSync(filename, 'utf8')));
}

function combineReports(reports) {
  const opponents = new Map();
  let threshold;
  for (let reportIndex = 0; reportIndex < reports.length; reportIndex++) {
    const report = reports[reportIndex];
    if (!report || report.incomplete) throw new Error(`Tournament report ${reportIndex} is incomplete`);
    if (reportIndex === 0) threshold = report.bombWinProbabilityThreshold ?? null;
    else if ((report.bombWinProbabilityThreshold ?? null) !== threshold) {
      throw new Error('Tournament chunks use different bomb win probability thresholds');
    }
    if (!report.opponents || typeof report.opponents !== 'object') {
      throw new Error(`Tournament report ${reportIndex} has no opponents`);
    }
    for (const [opponentId, result] of Object.entries(report.opponents)) {
      if (result?.incomplete) throw new Error(`Tournament report ${reportIndex} is incomplete for ${opponentId}`);
      if (!Array.isArray(result?.seedClusters)) throw new Error(`Tournament report ${reportIndex} has no seed clusters for ${opponentId}`);
      if (!opponents.has(opponentId)) opponents.set(opponentId, []);
      opponents.get(opponentId).push(...result.seedClusters);
    }
  }
  return { threshold: threshold ?? null, opponents };
}

function outcomePoints(game, label) {
  if (game?.invincibleSide !== 'blue' && game?.invincibleSide !== 'red') {
    throw new Error(`${label} game must identify Invincible as blue or red`);
  }
  if (game.winner === 'draw') return 0.5;
  if (game.winner === game.invincibleSide) return 1;
  if (game.winner === (game.invincibleSide === 'blue' ? 'red' : 'blue')) return 0;
  throw new Error(`${label} game has invalid winner ${game.winner}`);
}

function indexClusters(clusters, label) {
  if (!Array.isArray(clusters) || clusters.length === 0) throw new Error(`${label} has no completed seed clusters`);
  const indexed = new Map();
  for (const cluster of clusters) {
    if (!Number.isInteger(cluster?.seed) || cluster.seed < 0 || cluster.seed > UINT32_MAX) {
      throw new Error(`${label} contains an invalid seed`);
    }
    if (indexed.has(cluster.seed)) throw new Error(`${label} contains duplicate seed ${cluster.seed}`);
    if (typeof cluster.mapHash !== 'string' || !cluster.mapHash) throw new Error(`${label} seed ${cluster.seed} has no map hash`);
    if (!Array.isArray(cluster.games) || cluster.games.length !== 2) {
      throw new Error(`${label} seed ${cluster.seed} must contain exactly two paired games`);
    }
    const sides = cluster.games.map(game => game?.invincibleSide).sort();
    if (sides[0] !== 'blue' || sides[1] !== 'red') {
      throw new Error(`${label} seed ${cluster.seed} must contain one game per Invincible seat`);
    }
    for (const game of cluster.games) {
      outcomePoints(game, `${label} seed ${cluster.seed}`);
      if (!Number.isFinite(game.scoreMargin)) throw new Error(`${label} seed ${cluster.seed} has an invalid score margin`);
      if (game.mapHash !== undefined && game.mapHash !== cluster.mapHash) {
        throw new Error(`${label} seed ${cluster.seed} has an internal map hash mismatch`);
      }
    }
    indexed.set(cluster.seed, cluster);
  }
  return indexed;
}

function clusterMeasurements(cluster) {
  let winPoints = 0;
  let scoreMargin = 0;
  for (const game of cluster.games) {
    winPoints += outcomePoints(game, `seed ${cluster.seed}`);
    scoreMargin += game.scoreMargin;
  }
  return { winPoints: winPoints / 2, scoreMargin: scoreMargin / 2 };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sortedValues, probability) {
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position), upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const fraction = position - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * fraction;
}

function bootstrapInterval(values, bootstrapSeed, bootstrapReplicates) {
  const nextWord = seededWordGenerator(bootstrapSeed);
  const bootstrapValues = new Array(bootstrapReplicates);
  for (let replicate = 0; replicate < bootstrapReplicates; replicate++) {
    let total = 0;
    for (let index = 0; index < values.length; index++) {
      total += values[Math.floor((nextWord() / 0x100000000) * values.length)];
    }
    bootstrapValues[replicate] = total / values.length;
  }
  bootstrapValues.sort((left, right) => left - right);
  return { lower: percentile(bootstrapValues, 0.025), upper: percentile(bootstrapValues, 0.975) };
}

function matchMetrics(clusters) {
  const games = clusters.flatMap(cluster => cluster.games);
  const totalGames = games.length;
  const winRate = games.reduce((sum, game) => sum + outcomePoints(game, 'summary'), 0) / totalGames;
  const averageScoreMargin = games.reduce((sum, game) => sum + game.scoreMargin, 0) / totalGames;
  const bombsUsed = games.reduce((sum, game) => sum + (game.bombsUsed ?? 0), 0);
  const bombUseGames = games.filter(game => (game.bombsUsed ?? 0) > 0).length;
  const directBombs = games.reduce((sum, game) => sum + (game.directBombs ?? 0), 0);
  const directBombWins = games.reduce((sum, game) => sum + (game.directBombWins ?? 0), 0);
  const predictedBombCount = games.reduce((sum, game) => sum + (game.predictedBombCount ?? 0), 0);
  const predictedWinProbabilityTotal = games.reduce((sum, game) => sum
    + (game.meanPredictedWinProbability ?? 0) * (game.predictedBombCount ?? 0), 0);
  return {
    games: totalGames,
    winRate,
    averageScoreMargin,
    bombsUsed,
    bombUseRate: bombUseGames / totalGames,
    directBombs,
    directBombWins,
    predictedBombCount,
    meanPredictedWinProbability: predictedBombCount === 0 ? null : predictedWinProbabilityTotal / predictedBombCount,
    forecastCalibration: summarizeBombForecastCalibration(games),
  };
}

function compareOpponent(baselineClusters, treatmentClusters, { bootstrapSeed, bootstrapReplicates }) {
  const baseline = indexClusters(baselineClusters, 'baseline');
  const treatment = indexClusters(treatmentClusters, 'treatment');
  if (baseline.size !== treatment.size || [...baseline.keys()].some(seed => !treatment.has(seed))) {
    throw new Error('Baseline and treatment seed sets do not match');
  }

  const seeds = [...baseline.keys()].sort((left, right) => left - right);
  const winPointDeltas = [];
  const scoreMarginDeltas = [];
  for (const seed of seeds) {
    const baseCluster = baseline.get(seed), treatmentCluster = treatment.get(seed);
    if (baseCluster.mapHash !== treatmentCluster.mapHash) {
      throw new Error(`Baseline/treatment map hash mismatch for seed ${seed}`);
    }
    const base = clusterMeasurements(baseCluster);
    const treated = clusterMeasurements(treatmentCluster);
    winPointDeltas.push(treated.winPoints - base.winPoints);
    scoreMarginDeltas.push(treated.scoreMargin - base.scoreMargin);
  }

  return {
    seedClusters: seeds.length,
    baseline: matchMetrics(baselineClusters),
    treatment: matchMetrics(treatmentClusters),
    winPointDelta: mean(winPointDeltas),
    winPointDeltaCI95: bootstrapInterval(winPointDeltas, bootstrapSeed, bootstrapReplicates),
    scoreMarginDelta: mean(scoreMarginDeltas),
    scoreMarginDeltaCI95: bootstrapInterval(scoreMarginDeltas, (bootstrapSeed + 1) >>> 0, bootstrapReplicates),
  };
}

function compareTournamentTreatments(baselineInput, treatmentInput, {
  bootstrapSeed = 20261006,
  bootstrapReplicates = DEFAULT_BOOTSTRAP_REPLICATES,
} = {}) {
  if (!Number.isInteger(bootstrapSeed) || bootstrapSeed < 0 || bootstrapSeed > UINT32_MAX) {
    throw new Error('bootstrapSeed must be an unsigned 32-bit integer');
  }
  if (!Number.isInteger(bootstrapReplicates) || bootstrapReplicates <= 0) {
    throw new Error('bootstrapReplicates must be a positive integer');
  }
  const baseline = combineReports(reportsFromInput(baselineInput));
  const treatment = combineReports(reportsFromInput(treatmentInput));
  const baselineOpponents = [...baseline.opponents.keys()].sort();
  const treatmentOpponents = [...treatment.opponents.keys()].sort();
  if (JSON.stringify(baselineOpponents) !== JSON.stringify(treatmentOpponents)) {
    throw new Error('Baseline and treatment opponent sets do not match');
  }

  const opponents = {};
  for (let index = 0; index < baselineOpponents.length; index++) {
    const opponentId = baselineOpponents[index];
    opponents[opponentId] = compareOpponent(
      baseline.opponents.get(opponentId),
      treatment.opponents.get(opponentId),
      { bootstrapSeed: (bootstrapSeed + index) >>> 0, bootstrapReplicates },
    );
  }
  return {
    baselineBombWinProbabilityThreshold: baseline.threshold,
    treatmentBombWinProbabilityThreshold: treatment.threshold,
    bootstrapSeed,
    bootstrapReplicates,
    opponents,
  };
}

if (require.main === module) {
  try {
    const [baselinePath, treatmentPath, ...extra] = process.argv.slice(2);
    if (!baselinePath || !treatmentPath || extra.length) {
      throw new Error('Usage: node scripts/compare-ai-tournament-treatments.js BASELINE_REPORT_OR_DIR TREATMENT_REPORT_OR_DIR');
    }
    const comparison = compareTournamentTreatments(baselinePath, treatmentPath);
    process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { compareTournamentTreatments };
