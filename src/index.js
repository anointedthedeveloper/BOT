import 'dotenv/config';
import { loadConfig, ConfigError } from './config/index.js';
import { createLogger } from './utils/logger.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    console.error('\nCopy .env.example to .env and fill in the required values.');
    process.exit(2);
  }
  throw err;
}

const logger = createLogger(config);
let app;

process.on('unhandledRejection', (reason) => {
  if (app) app.deps.errorReporter.report(reason, { scope: 'unhandledRejection' });
  else logger.error({ err: reason }, 'unhandled rejection during startup');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  if (app) app.shutdown(1, 'uncaughtException');
  else process.exit(1);
});

try {
  app = await createApp(config, { logger });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.shutdown(0, sig));
  await app.start();
} catch (err) {
  logger.fatal({ err }, 'failed to start');
  if (app) await app.shutdown(1, 'start-failed');
  else process.exit(1);
}
