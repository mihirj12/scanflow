import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pino, { type Logger } from 'pino';
import { pinoHttp } from 'pino-http';

import type { AppContainer } from '../container.js';

import { errorHandler } from './middleware/errorHandler.js';
import { buildApiRouter } from './routes/api.routes.js';

export function createApp(
  container: AppContainer,
  options?: { log?: Logger },
): {
  app: Express;
  log: Logger;
} {
  const log = options?.log ?? pino({ level: container.config.LOG_LEVEL });
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: container.config.CORS_ORIGIN }));
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger: log,
      // Never log request bodies — they can contain patient identifiers.
      serializers: {
        req(req: { method?: string; url?: string }) {
          return { method: req.method, url: req.url };
        },
      },
    }),
  );

  app.use('/api/v1', buildApiRouter(container));

  app.use(
    errorHandler({
      log,
      clinicId: container.config.CLINIC_ID,
      loadFreshCandidates: container.useCases.loadFreshCandidates,
    }),
  );

  return { app, log };
}
