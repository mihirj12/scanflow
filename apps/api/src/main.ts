import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { createApp } from './http/app.js';

function main(): void {
  const config = loadConfig();
  const container = createContainer(config);
  const { app, log } = createApp(container);

  app.listen(config.PORT, () => {
    log.info({ port: config.PORT }, 'ScanFlow API listening');
  });
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exit(1);
}
