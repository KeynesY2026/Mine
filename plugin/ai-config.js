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
      description: '轻量的局部规则判断，复杂局面偶尔需要猜测。',
      src: 'plugin/ai-heuristic.js',
      coreMethod: 'weakDecide',
    },
    {
      id: 'global-probability',
      label: '中等',
      description: '结合全局剩余雷数估算概率，偏向争取高分。',
      src: 'plugin/ai-global-probability.js',
      coreMethod: 'strongDecide',
    },
    {
      id: 'constraint-probability',
      label: '无敌',
      description: '枚举线索约束，优先低风险选择，并谨慎规划炸弹。',
      src: 'plugin/ai-constraint-probability.js',
    },
  ],
};
