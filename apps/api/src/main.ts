import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { createApp } from './http/app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const container = await createContainer(config);
  const { app, log } = createApp(container, { log: container.log });

  const server = app.listen(config.PORT, () => {
    log.info({ port: config.PORT }, 'ScanFlow API listening');
  });

  // Drain the Redis connections on shutdown, or the process hangs on SIGTERM.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      log.info({ signal }, 'shutting down');
      server.close(() => {
        void container.events.close();
      });
    });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
