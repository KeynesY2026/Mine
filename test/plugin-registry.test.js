const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const sandbox = {
  window: {
    MineCore: {
      weakDecide: view => ({ type: 'open', x: view.width - 1, y: 0 }),
      strongDecide: view => ({ type: 'bomb', x: 0, y: view.height - 1 }),
    },
  },
};
const source = fs.existsSync('js/ai-registry.js')
  ? fs.readFileSync('js/ai-registry.js', 'utf8')
  : '';
vm.runInNewContext(source, sandbox);
const createRegistry = sandbox.window.MineAIRegistry?.create;

const configContext = { window: {} };
vm.runInNewContext(fs.readFileSync('plugin/ai-config.js', 'utf8'), configContext);
const definitions = configContext.window.MineAIConfig;

function registry() {
  assert.equal(typeof createRegistry, 'function', 'AI registry is available');
  const loadedScripts = [];
  const pluginFunctions = {
    'constraint-probability': view => ({ type: 'open', x: view.width - 1, y: view.height - 1 }),
  };
  const loadScript = async (src, agent) => {
    loadedScripts.push(src);
    if (agent.id === 'constraint-probability') {
      sandbox.window.MineAIPlugins.register(agent.id, pluginFunctions[agent.id]);
    }
  };
  const agents = createRegistry(sandbox.window.MineCore, definitions, loadScript);
  return { agents, loadedScripts };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('manifest lists unified AI tiers with descriptions and lazy scripts', () => {
  const { agents, loadedScripts } = registry();
  const listed = plain(agents.list());

  assert.deepEqual(listed.map(agent => agent.id), [
    'human', 'heuristic', 'global-probability', 'constraint-probability',
  ]);
  assert.deepEqual(listed.slice(1).map(agent => agent.label), ['简单', '中等', '无敌']);
  assert.ok(listed.slice(1).every(agent => typeof agent.description === 'string' && agent.description.length > 0));
  assert.ok(listed.slice(1).every(agent => !Object.hasOwn(agent, 'category')));
  assert.equal(agents.isLoaded('heuristic'), false);
  assert.equal(agents.isLoaded('global-probability'), false);
  assert.equal(agents.isLoaded('constraint-probability'), false);
  assert.deepEqual(loadedScripts, []);
});

test('selecting one AI loads only its script and reuses the loaded decision function', async () => {
  const { agents, loadedScripts } = registry();
  const decide = await agents.load('heuristic');

  assert.deepEqual(plain(decide({ width: 4, height: 2 })), { type: 'open', x: 3, y: 0 });
  assert.equal(agents.isLoaded('heuristic'), true);
  assert.equal(agents.isLoaded('global-probability'), false);
  assert.equal(agents.isLoaded('constraint-probability'), false);
  assert.deepEqual(loadedScripts, ['plugin/ai-heuristic.js']);
  assert.equal(await agents.load('heuristic'), decide);
  assert.deepEqual(loadedScripts, ['plugin/ai-heuristic.js']);
});

test('plugin scripts register under their configured id when loaded', async () => {
  const { agents, loadedScripts } = registry();
  const decide = await agents.load('constraint-probability');

  assert.deepEqual(plain(decide({ width: 3, height: 2 })), { type: 'open', x: 2, y: 1 });
  assert.deepEqual(loadedScripts, ['plugin/ai-constraint-probability.js']);
});

test('failed or unregistered plugin loads reject without marking the plugin loaded', async () => {
  const { agents } = registry();
  await assert.rejects(agents.load('missing'), /Unknown AI: missing/);

  const broken = createRegistry(sandbox.window.MineCore, {
    agents: [{ id: 'bad', label: '坏插件', src: 'plugin/bad.js' }],
  }, async () => {});
  await assert.rejects(broken.load('bad'), /did not register/);
  assert.equal(broken.isLoaded('bad'), false);
});
