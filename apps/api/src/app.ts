import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';
import { createOpenApiDocument } from './api/openapi.js';
import { problem } from './api/problem.js';
import { createRouteCatalog, registerRoutes } from './api/route-catalog.js';
import { createLocalAuth } from './auth/local-auth.js';
import { createDbPool } from '../../../packages/db/src/client.js';

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function docsEnabled(): boolean {
  return !isProduction() && process.env.OPENAPI_DOCS_ENABLED === 'true';
}

function webRoot(): string {
  return path.resolve(process.cwd(), 'apps/web/src');
}

export function createApp() {
  const app = express();
  const authProvider = process.env.AUTH_PROVIDER || 'local';
  const databaseUrl = process.env.DATABASE_URL;
  // Shared by both Team logins (local-auth.ts) and every pool-backed service
  // created inside the route catalog below, so they all read/write the same
  // database rather than each opening its own connection pool (see
  // modification.md #20).
  const pool = databaseUrl ? createDbPool(databaseUrl) : null;
  const localAuth =
    authProvider === 'local' && !isProduction() && pool
      ? createLocalAuth({ bootstrapToken: process.env.LOCAL_BOOTSTRAP_TOKEN }, pool)
      : null;
  const routes = createRouteCatalog(localAuth, pool);

  app.disable('x-powered-by');
  // helmet()'s defaults include a Content-Security-Policy with
  // upgrade-insecure-requests and an HSTS header -- both tell the browser to
  // silently retry every request (including plain <img> subresources and
  // navigation) over https. That's correct once this is deployed behind
  // TLS, but it silently breaks local/LAN testing over plain HTTP (e.g.
  // http://192.168.x.x:3100/), where the browser's upgraded https request
  // just fails with nothing served on that port. Keep the full policy in
  // production; relax just those two directives everywhere else.
  app.use(isProduction() ? helmet() : helmet({ contentSecurityPolicy: false, hsts: false }));
  app.use(express.json({ limit: '1mb' }));

  if (docsEnabled()) {
    const openApiDocument = createOpenApiDocument(routes);
    app.get('/api/openapi.json', (_request, response) => {
      response.type('application/vnd.oai.openapi+json').json(openApiDocument);
    });
    app.use(
      '/api/docs',
      helmet({
        contentSecurityPolicy: {
          directives: {
            'script-src': ["'self'", "'unsafe-inline'"],
            'style-src': ["'self'", "'unsafe-inline'"],
            'img-src': ["'self'", 'data:'],
            'font-src': ["'self'", 'data:'],
            'connect-src': ["'self'"],
            'object-src': ["'none'"],
            'frame-ancestors': ["'none'"],
          },
        },
      }),
      swaggerUi.serve,
      swaggerUi.setup(openApiDocument, {
        customSiteTitle: "Jacky's Service Portal API",
        swaggerOptions: { url: '/api/openapi.json' },
      }),
    );
  }

  registerRoutes(app, routes);

  // Public marketing/landing page and standalone customer complaint page,
  // both served from the same static web root but without the SPA's
  // index.html fallback (index: false) so requesting '/' or a bare file
  // name doesn't accidentally serve the staff portal shell.
  app.use(express.static(webRoot(), { index: false }));
  app.get('/', (_request, response) => {
    response.sendFile(path.join(webRoot(), 'landing.html'));
  });
  app.get(['/complaints', '/complaints/'], (_request, response) => {
    response.sendFile(path.join(webRoot(), 'complaints.html'));
  });

  app.use('/portal', express.static(webRoot(), { index: 'index.html' }));
  app.get('/portal/*splat', (_request, response) => {
    response.sendFile(path.join(webRoot(), 'index.html'));
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        problem(
          response,
          400,
          'invalid-request',
          'Invalid request',
          'The request is invalid: ' +
            error.issues
              .map(
                (issue) => (issue.path.length ? issue.path.join('.') + ': ' : '') + issue.message,
              )
              .join('; '),
        );
        return;
      }
      console.error(error);
      // Staff-only application: show the real reason plus the request id so a
      // failure can be reported and traced without opening the server log.
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      problem(
        response,
        500,
        'internal-error',
        'Internal Server Error',
        `An unexpected error occurred: ${reason}`,
      );
    },
  );

  return app;
}
