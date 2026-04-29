const baseConfigs = require('./eslint.config.cjs');

const overrides = {
  rules: {
    'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: false, IIFEs: false }],
    'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx', 'hack'], location: 'anywhere' }],
    'logs/no-line-comments': 'error',
  },
};

module.exports = baseConfigs.map((cfg) => {
  if (!cfg || !cfg.rules) return cfg;
  return { ...cfg, rules: { ...cfg.rules, ...overrides.rules } };
});
