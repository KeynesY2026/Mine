"use strict";

(() => {
  function copyJson(value) {
    if (value === undefined) return null;
    const seen = new WeakSet();
    const serialized = JSON.stringify(value, (key, item) => {
      if (typeof item === 'bigint') return item.toString() + 'n';
      if (typeof item === 'function') return '[Function ' + (item.name || 'anonymous') + ']';
      if (typeof item === 'symbol') return String(item);
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return item;
    });
    return serialized === undefined ? String(value) : JSON.parse(serialized);
  }

  function createGameLog({ startedAt, width, height, settings, aiBySide, actualMineMap }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new TypeError('diagnostic log requires positive integer dimensions');
    }
    if (!Array.isArray(actualMineMap) || actualMineMap.length !== width * height) {
      throw new TypeError('diagnostic log requires a complete mine map');
    }
    return {
      schemaVersion: 1,
      startedAt,
      settings: { ...copyJson(settings || {}), width, height },
      aiBySide: copyJson(aiBySide || {}),
      actualMineMap: Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => Number(actualMineMap[y * width + x]))),
      moves: [],
    };
  }

  function captureView(view, threshold) {
    const winNeed = Math.floor(view.mineCount / 2) + 1;
    const neededHits = winNeed - view.score;
    const publicBoard = Array.from({ length: view.height }, (_, y) =>
      Array.from({ length: view.width }, (_, x) => view.cellAt(x, y)));
    const analysis = view.analysis || null;
    const bombCandidates = analysis ? Array.from(analysis.bombCenters || [], candidate => {
      const probabilities = Array.isArray(candidate.uniformHitCountProbabilities)
        ? Array.from(candidate.uniformHitCountProbabilities)
        : null;
      let directWinProbability = null;
      if (probabilities) {
        directWinProbability = 0;
        for (let hits = Math.max(0, neededHits); hits < probabilities.length; hits++) {
          directWinProbability += probabilities[hits];
        }
      }
      return {
        x: candidate.x,
        y: candidate.y,
        hiddenCount: candidate.hiddenCount,
        expectedMines: candidate.expectedMines,
        directWinProbability,
        directWinProbabilityModel: probabilities ? 'uniform-valid-layouts' : null,
        uniformHitCountProbabilities: probabilities,
      };
    }) : null;

    return {
      player: view.turn,
      score: view.score,
      oppScore: view.oppScore,
      mineCount: view.mineCount,
      remainMines: view.remainMines,
      bombs: view.bombs,
      canBomb: view.canBomb,
      threshold: Number.isFinite(threshold) ? threshold : null,
      winNeed,
      neededHits,
      publicBoard,
      analysis: analysis ? {
        quality: analysis.quality,
        error: analysis.error ?? null,
        hiddenCount: analysis.hiddenCells?.length ?? null,
        frontierCount: analysis.frontierCells?.length ?? null,
        freeCount: analysis.freeCells?.length ?? null,
        bombCandidates,
      } : null,
    };
  }

  function recordMove(log, move) {
    if (!log || !Array.isArray(log.moves)) throw new TypeError('invalid diagnostic game log');
    const result = move.result || null;
    log.moves.push({
      index: log.moves.length + 1,
      player: move.player,
      agent: move.agent || 'human',
      fallbackAgent: move.fallbackAgent ?? null,
      before: copyJson(move.before),
      decision: {
        requestedAction: copyJson(move.requestedAction),
        executedAction: copyJson(move.executedAction),
        invalid: !!move.invalid,
        decisionSourceFailed: !!move.decisionSourceFailed,
        error: move.decisionError ?? null,
      },
      result: result ? {
        ok: !!result.ok,
        why: result.why ?? null,
        kind: result.kind ?? null,
        x: result.x ?? null,
        y: result.y ?? null,
        mines: result.mines ?? null,
        cells: Array.isArray(result.cells) ? Array.from(result.cells) : null,
      } : null,
      after: copyJson(move.after),
    });
    return log.moves[log.moves.length - 1];
  }

  function createExportDocument(log, finalState, exportedAt) {
    if (!log || log.schemaVersion !== 1) throw new TypeError('unsupported diagnostic log');
    return {
      ...copyJson(log),
      exportedAt,
      finalState: copyJson(finalState),
    };
  }

  window.MineDiagnosticLog = Object.freeze({ createGameLog, captureView, recordMove, createExportDocument });
})();
