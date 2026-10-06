'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const RUNTIME_SCRIPTS = [
  'js/core.js',
  'js/ai-planner.js',
  'js/ai-decision.js',
  'plugin/ai-heuristic.js',
  'plugin/ai-global-probability.js',
  'plugin/ai-constraint-probability.js',
];

function createSeededCrypto(seed) {
  let state = Number(seed) >>> 0;
  if (state === 0) state = 0x6d2b79f5;

  return {
    getRandomValues(typedArray) {
      for (let index = 0; index < typedArray.length; index++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        typedArray[index] = state >>> 0;
      }
      return typedArray;
    },
  };
}

function createRuntime(seed) {
  const registrations = new Map();
  const context = vm.createContext({
    window: {},
    crypto: createSeededCrypto(seed),
  });
  context.window.MineAIPlugins = {
    register(id, decide) {
      if (registrations.has(id)) throw new Error(`Duplicate plugin registration: ${id}`);
      registrations.set(id, decide);
    },
  };

  for (const relativePath of RUNTIME_SCRIPTS) {
    const filename = path.resolve(process.cwd(), relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    vm.runInContext(source, context, { filename });
  }

  const core = { MineCore: context.window.MineCore };
  const planner = { MineAIPlanner: context.window.MineAIPlanner };
  const decisionGuard = context.window.MineAIDecision;
  const decisions = {
    heuristic: core.MineCore?.weakDecide,
    'global-probability': core.MineCore?.strongDecide,
    'constraint-probability': registrations.get('constraint-probability'),
  };

  for (const [id, decide] of Object.entries(decisions)) {
    if (typeof decide !== 'function') throw new Error(`Missing decision registration: ${id}`);
  }
  if (!planner || !decisionGuard) throw new Error('Runtime did not load the AI planner and decision guard');

  return { core, planner, decisionGuard, decisions };
}

function runMatch({
  seed,
  invincibleSide,
  opponentId,
  width = 15,
  height = 15,
  mineCount = 53,
  bombCount = 1,
  includeTrace = false,
  includeHiddenMap = false,
}, runtimeOverride) {
  if (invincibleSide !== 'blue' && invincibleSide !== 'red') {
    throw new Error(`Invalid Invincible side: ${invincibleSide}`);
  }
  if (opponentId !== 'heuristic' && opponentId !== 'global-probability') {
    throw new Error(`Invalid opponent ID: ${opponentId}`);
  }

  const runtime = runtimeOverride || createRuntime(seed);
  const { MineCore } = runtime.core;
  const game = new MineCore.Game({ width, height, mineCount, bombCount });
  const opponentSide = invincibleSide === 'blue' ? 'red' : 'blue';
  const mapHash = createHash('sha256').update(Buffer.from(game.mines)).digest('hex');
  const trace = [];
  const moveLimit = width * height + 1;

  function makeView(player) {
    const source = game.view(player, { ai: true });
    const values = Array.from({ length: game.total }, (_, index) =>
      source.cellAt(index % width, Math.floor(index / width)));
    Object.freeze(values);
    const snapshot = Object.freeze({
      width,
      height,
      mineCount: game.mineCount,
      remainMines: game.remainMines,
      cellAt(x, y) {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return -2;
        return values[y * width + x];
      },
    });
    const analysis = runtime.planner.MineAIPlanner.analyze(snapshot);
    const view = Object.freeze({
      width: source.width,
      height: source.height,
      score: source.score,
      oppScore: source.oppScore,
      mineCount: source.mineCount,
      remainMines: source.remainMines,
      bombs: source.bombs,
      canBomb: source.canBomb,
      enhancedAI: true,
      bombRadiusH: source.bombRadiusH,
      bombRadiusV: source.bombRadiusV,
      turn: source.turn,
      analysis,
      cellAt: snapshot.cellAt,
    });
    return { view, values };
  }

  function decisionCopy(decision) {
    if (!decision || typeof decision !== 'object') return decision ?? null;
    const copy = {};
    for (const key of ['type', 'x', 'y']) {
      if (decision[key] !== undefined) copy[key] = decision[key];
    }
    if (decision.fallback !== undefined) copy.fallback = decisionCopy(decision.fallback);
    return copy;
  }

  function traceView(view, values) {
    return {
      width: view.width,
      height: view.height,
      cells: values.slice(),
      score: view.score,
      oppScore: view.oppScore,
      mineCount: view.mineCount,
      remainMines: view.remainMines,
      bombs: view.bombs,
      canBomb: view.canBomb,
      enhancedAI: view.enhancedAI,
      bombRadiusH: view.bombRadiusH,
      bombRadiusV: view.bombRadiusV,
      turn: view.turn,
    };
  }

  let moveCount = 0;
  while (!game.over && moveCount < moveLimit) {
    const actor = game.turn;
    const pluginId = actor === invincibleSide ? 'constraint-probability' : opponentId;
    const { view, values } = makeView(actor);
    const scoresBefore = { blue: game.scores.blue, red: game.scores.red };
    const bombsBefore = { blue: game.bombs.blue, red: game.bombs.red };
    const decision = runtime.decisions[pluginId](view);
    const fallbackDecision = runtime.planner.MineAIPlanner.chooseFallback(
      view,
      view.analysis,
      MineCore.randInt,
    );
    const resolved = runtime.decisionGuard.resolve(game, actor, decision, { fallbackDecision });
    if (resolved.invalid === true) {
      throw new Error(`Invalid AI decision for ${pluginId} (${actor}) at seed ${seed}`);
    }
    if (resolved.noMoves || !resolved.action) {
      throw new Error(`No legal action for ${actor} with hidden cells remaining`);
    }

    const executedAction = resolved.action;
    let result;
    if (executedAction.type === 'open') result = game.open(executedAction.x, executedAction.y);
    else if (executedAction.type === 'bomb') result = game.bomb(executedAction.x, executedAction.y, { ai: true });
    else result = { ok: false, why: 'unsupported-action' };
    if (!result?.ok) {
      throw new Error(`Action failed for ${actor} after decision resolution: ${result?.why || 'unknown reason'}`);
    }

    moveCount++;
    if (includeTrace) {
      const publicAfter = game.view(actor, { ai: true });
      trace.push({
        actor,
        view: traceView(view, values),
        scoresBefore,
        bombsBefore,
        decision: decisionCopy(decision),
        resolvedAction: decisionCopy(resolved.action),
        executedAction: decisionCopy(executedAction),
        revealedCells: result.cells.map(index => ({
          index,
          value: publicAfter.cellAt(index % width, Math.floor(index / width)),
        })),
        scoresAfter: { blue: game.scores.blue, red: game.scores.red },
        bombsAfter: { blue: game.bombs.blue, red: game.bombs.red },
      });
    }
  }

  if (!game.over) throw new Error(`Match did not finish within ${moveLimit} actions`);

  const invincibleScore = game.scores[invincibleSide];
  const opponentScore = game.scores[opponentSide];
  const result = {
    seed,
    invincibleSide,
    opponentId,
    winner: game.winner,
    scores: { blue: game.scores.blue, red: game.scores.red },
    scoreMargin: invincibleScore - opponentScore,
    bombsUsed: game.bombMax - game.bombs[invincibleSide],
    moveCount,
    mapHash,
  };
  if (includeTrace) result.trace = trace;
  if (includeHiddenMap) result.hiddenMap = Array.from(game.mines);
  return result;
}

module.exports = { createSeededCrypto, createRuntime, runMatch };
