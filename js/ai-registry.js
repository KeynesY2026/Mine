"use strict";

(() => {
  function create(core, config = window.MineAIConfig, scriptLoader = loadScript) {
    const definitions = config?.agents || [];
    const agents = new Map([
      ['human', { id: 'human', label: '人类', description: '', loaded: true, decide: null }],
    ]);
    const registered = new Map();

    for (const definition of definitions) {
      if (!definition.id || !definition.src || agents.has(definition.id)) {
        throw new Error('Invalid or duplicate AI configuration');
      }
      agents.set(definition.id, {
        ...definition,
        loaded: false,
        decide: null,
        pending: null,
      });
    }

    window.MineAIPlugins = {
      register(id, decide) {
        const agent = agents.get(id);
        if (!agent || agent.coreMethod) throw new Error('Unknown plugin registration id: ' + id);
        if (typeof decide !== 'function') throw new Error('Plugin must register a decision function: ' + id);
        if (registered.has(id)) throw new Error('Duplicate plugin registration: ' + id);
        registered.set(id, decide);
      },
    };

    function publicAgent(agent) {
      if (!agent) return null;
      return {
        id: agent.id,
        label: agent.label,
        description: agent.description || '',
        src: agent.src,
        loaded: agent.loaded,
      };
    }

    async function load(id) {
      const agent = agents.get(id);
      if (!agent) throw new Error('Unknown AI: ' + id);
      if (id === 'human') return null;
      if (agent.loaded) return agent.decide;
      if (agent.pending) return agent.pending;

      agent.pending = Promise.resolve()
        .then(() => scriptLoader(agent.src, publicAgent(agent)))
        .then(() => {
          const decide = agent.coreMethod ? core[agent.coreMethod] : registered.get(id);
          if (typeof decide !== 'function') throw new Error('AI script did not register a decision function: ' + agent.src);
          agent.decide = decide;
          agent.loaded = true;
          return decide;
        })
        .finally(() => { agent.pending = null; });
      return agent.pending;
    }

    return {
      defaultBySide: config?.defaultBySide || {},
      fallbackId: config?.fallbackId || config?.defaultBySide?.red || definitions[0]?.id || null,
      get(id) { return publicAgent(agents.get(id)); },
      list() { return Array.from(agents.values(), publicAgent); },
      isLoaded(id) { return agents.get(id)?.loaded === true; },
      load,
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('无法加载 AI 脚本: ' + src));
      document.head.appendChild(script);
    });
  }

  window.MineAIRegistry = { create };
})();
