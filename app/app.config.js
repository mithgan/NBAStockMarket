const { marketBuildEnvironment } = require('./scripts/market-config.cjs');

module.exports = ({ config }) => {
  if (process.env.MARKET_WEB_ENVIRONMENT === undefined) return config;
  const expected = marketBuildEnvironment(process.env.MARKET_WEB_ENVIRONMENT, process.env);
  for (const [name, value] of Object.entries(expected)) {
    if (process.env[name] !== value) {
      throw new Error('Use the export:market script to set the matching public build configuration.');
    }
  }
  return {
    ...config,
    experiments: { ...config.experiments, baseUrl: '/market' },
  };
};
