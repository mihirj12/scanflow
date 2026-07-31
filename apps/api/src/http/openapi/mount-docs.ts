import { apiReference } from '@scalar/express-api-reference';
import { buildOpenApiDocument } from '@scanflow/contracts/openapi';
import type { Express } from 'express';

/**
 * Interactive API reference and machine-readable spec. Mounted outside `/api/v1`
 * so documentation stays public while business routes require auth.
 */
export function mountApiDocs(app: Express): void {
  app.get('/api/openapi.json', (_req, res) => {
    res.json(buildOpenApiDocument());
  });

  app.use(
    '/api/docs',
    apiReference({
      url: '/api/openapi.json',
      pageTitle: 'ScanFlow API',
    }),
  );
}
