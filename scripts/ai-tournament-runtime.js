'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

module.exports = { createSeededCrypto, createRuntime };
