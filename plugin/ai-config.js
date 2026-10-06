"use strict";

window.MineAIConfig = {
  defaultBySide: {
    blue: 'human',
    red: 'constraint-probability',
  },
  fallbackId: 'global-probability',
  agents: [
    {
      id: 'heuristic',
      label: '简单',
      description: '简单的局部选点规则，使用共享概率分析，复杂局面偶尔需要猜测。',
      src: 'plugin/ai-heuristic.js',
      coreMethod: 'weakDecide',
    },
    {
      id: 'global-probability',
      label: '中等',
      description: '全局最高概率优先，保留中等难度的边缘与炸弹规则。',
      src: 'plugin/ai-global-probability.js',
      coreMethod: 'strongDecide',
    },
    {
      id: 'constraint-probability',
      label: '无敌',
      description: '先收取确定雷；再按岛边与未知区概率规划探索和炸弹。',
      src: 'plugin/ai-constraint-probability.js',
    },
  ],
};
