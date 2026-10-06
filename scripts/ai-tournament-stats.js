'use strict';

const { runMatch } = require('./ai-tournament-runtime');

const UINT32_MAX = 0xffffffff;

function validateTournamentOptions({ opponentId, seedStart, seedCount }) {
  if (opponentId !== 'heuristic' && opponentId !== 'global-probability') {
    throw new Error(`Invalid opponent ID: ${opponentId}`);
  }
  if (!Number.isInteger(seedStart) || seedStart < 0 || seedStart > UINT32_MAX) {
    throw new Error('seedStart must be an unsigned 32-bit integer');
  }
  if (!Number.isInteger(seedCount) || seedCount <= 0) {
    throw new Error('seedCount must be a positive integer');
  }
  if (seedStart + seedCount - 1 > UINT32_MAX) {
    throw new Error('Tournament seed range exceeds unsigned 32-bit integers');
  }
}

function runTournament({
  opponentId,
  seedStart,
  seedCount,
  width = 15,
  height = 15,
  mineCount = 53,
  bombCount = 1,
  includeTrace = false,
  includeHiddenMap = false,
}) {
  validateTournamentOptions({ opponentId, seedStart, seedCount });

  const matches = [];
  const seedClusters = [];

  for (let offset = 0; offset < seedCount; offset++) {
    const seed = seedStart + offset;
    const games = [];

    for (const invincibleSide of ['blue', 'red']) {
      let game;
      try {
        game = runMatch({
          seed,
          invincibleSide,
          opponentId,
          width,
          height,
          mineCount,
          bombCount,
          includeTrace,
          includeHiddenMap,
        });
      } catch (error) {
        return {
          opponentId,
          seedStart,
          seedCount,
          matches,
          seedClusters,
          incomplete: {
            failedSeed: seed,
            failedSeat: invincibleSide,
            errorCount: 1,
            error: error instanceof Error ? error.message : String(error),
            successfulPartialGames: games,
          },
        };
      }

      matches.push(game);
      games.push(game);
    }

    if (games[0].mapHash !== games[1].mapHash) {
      return {
        opponentId,
        seedStart,
        seedCount,
        matches,
        seedClusters,
        incomplete: {
          failedSeed: seed,
          failedSeat: 'red',
          errorCount: 1,
          error: `Paired map hash mismatch for seed ${seed}`,
          successfulPartialGames: games,
        },
      };
    }

    seedClusters.push({ seed, mapHash: games[0].mapHash, games });
  }

  return { opponentId, seedStart, seedCount, matches, seedClusters };
}

function gameOutcome(game) {
  if (game.invincibleSide !== 'blue' && game.invincibleSide !== 'red') {
    throw new Error('Each game must identify Invincible as blue or red');
  }
  if (game.winner === 'draw') return 0.5;
  if (game.winner === game.invincibleSide) return 1;
  if (game.winner === (game.invincibleSide === 'blue' ? 'red' : 'blue')) return 0;
  throw new Error(`Invalid game winner: ${game.winner}`);
}

function validateSeedClusters(seedClusters) {
  if (!Array.isArray(seedClusters) || seedClusters.length === 0) {
    throw new Error('At least one completed seed cluster is required');
  }

  return seedClusters.map((cluster, clusterIndex) => {
    if (!cluster || !Array.isArray(cluster.games) || cluster.games.length !== 2) {
      throw new Error(`Seed cluster ${clusterIndex} must contain exactly two paired games`);
    }
    const sides = cluster.games.map(game => game?.invincibleSide).sort();
    if (sides[0] !== 'blue' || sides[1] !== 'red') {
      throw new Error(`Seed cluster ${clusterIndex} must contain one game per Invincible seat`);
    }

    const outcomes = [];
    for (const game of cluster.games) {
      const points = gameOutcome(game);
      if (!Number.isFinite(game.scoreMargin)) {
        throw new Error(`Seed cluster ${clusterIndex} contains a game without a finite score margin`);
      }
      if (!Number.isInteger(game.bombsUsed) || game.bombsUsed < 0) {
        throw new Error(`Seed cluster ${clusterIndex} contains an invalid Invincible bomb count`);
      }
      if (game.mapHash !== undefined && game.mapHash !== cluster.mapHash) {
        throw new Error(`Seed cluster ${clusterIndex} contains mismatched map hashes`);
      }
      outcomes.push(points);
    }
    return outcomes;
  });
}

function seededWordGenerator(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > UINT32_MAX) {
    throw new Error('bootstrapSeed must be an unsigned 32-bit integer');
  }
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function percentile(sortedValues, probability) {
  const position = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const fraction = position - lowerIndex;
  return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * fraction;
}

function summarizeTournament(seedClusters, { bootstrapSeed, bootstrapReplicates = 10000 } = {}) {
  if (!Number.isInteger(bootstrapReplicates) || bootstrapReplicates <= 0) {
    throw new Error('bootstrapReplicates must be a positive integer');
  }
  const clusterOutcomes = validateSeedClusters(seedClusters);
  const nextWord = seededWordGenerator(bootstrapSeed);
  const games = seedClusters.flatMap(cluster => cluster.games);
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let scoreMarginTotal = 0;
  let bombUseCount = 0;

  for (const game of games) {
    const points = gameOutcome(game);
    if (points === 1) wins++;
    else if (points === 0.5) draws++;
    else losses++;
    scoreMarginTotal += game.scoreMargin;
    if (game.bombsUsed > 0) bombUseCount++;
  }

  const bootstrapRates = new Array(bootstrapReplicates);
  for (let replicate = 0; replicate < bootstrapReplicates; replicate++) {
    let samplePoints = 0;
    for (let index = 0; index < clusterOutcomes.length; index++) {
      const sampledCluster = Math.floor((nextWord() / 0x100000000) * clusterOutcomes.length);
      const outcomes = clusterOutcomes[sampledCluster];
      samplePoints += (outcomes[0] + outcomes[1]) / 2;
    }
    bootstrapRates[replicate] = samplePoints / clusterOutcomes.length;
  }
  bootstrapRates.sort((left, right) => left - right);

  return {
    games: games.length,
    wins,
    draws,
    losses,
    winRate: (wins + draws * 0.5) / games.length,
    confidence95: {
      lower: percentile(bootstrapRates, 0.025),
      upper: percentile(bootstrapRates, 0.975),
    },
    averageScoreMargin: scoreMarginTotal / games.length,
    bombUseRate: bombUseCount / games.length,
    errors: 0,
  };
}

module.exports = { runTournament, summarizeTournament };
