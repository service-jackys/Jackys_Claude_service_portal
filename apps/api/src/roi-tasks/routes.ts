import type { RequestHandler, Response } from 'express';
import multer from 'multer';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { MAX_ROI_IMPORT_BYTES, RoiServiceError, type RoiService } from './service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ROI_IMPORT_BYTES, files: 1 },
});

function fail(error: unknown, response: Response): boolean {
  if (!(error instanceof RoiServiceError)) return false;
  if (error.code === 'not-found') problem(response, 404, 'not-found', 'Not Found', error.message);
  else if (error.code === 'forbidden')
    problem(response, 403, 'forbidden', 'Forbidden', error.message);
  else problem(response, 400, error.code, 'Bad Request', error.message);
  return true;
}

export function createRoiHandlers(
  service: RoiService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  const use = requirePermission('tasks.use');
  const wrap =
    (
      run: (
        auth: ApplicationAuth,
        request: Parameters<RequestHandler>[0],
        response: Parameters<RequestHandler>[1],
      ) => Promise<void>,
    ): RequestHandler =>
    async (request, response, next) => {
      try {
        await run(response.locals.auth as ApplicationAuth, request, response);
      } catch (error) {
        if (fail(error, response)) return;
        next(error);
      }
    };

  return {
    list: [
      use,
      wrap(async (auth, request, response) => {
        const [tasks, owners] = await Promise.all([
          service.list(auth, request.query),
          service.owners(auth),
        ]);
        response.json({ tasks, owners });
      }),
    ],
    create: [
      use,
      wrap(async (auth, request, response) => {
        response.status(201).json({ task: await service.create(auth, request.body) });
      }),
    ],
    update: [
      use,
      wrap(async (auth, request, response) => {
        response.json({
          task: await service.update(auth, String(request.params.id), request.body),
        });
      }),
    ],
    remove: [
      use,
      wrap(async (auth, request, response) => {
        await service.remove(auth, String(request.params.id));
        response.status(204).end();
      }),
    ],
    settings: [
      use,
      wrap(async (auth, _request, response) => {
        response.json({ settings: await service.settings(auth) });
      }),
    ],
    saveSettings: [
      use,
      wrap(async (auth, request, response) => {
        response.json({ settings: await service.saveSettings(auth, request.body) });
      }),
    ],
    reports: [
      use,
      wrap(async (auth, _request, response) => {
        response.json({ reports: await service.reports(auth) });
      }),
    ],
    logReport: [
      use,
      wrap(async (auth, request, response) => {
        const id = await service.logReport(
          auth,
          request.body,
          request.header('x-request-id') ?? undefined,
        );
        response.status(201).json({ id });
      }),
    ],
    importPreview: [
      use,
      upload.single('file'),
      wrap(async (_auth, request, response) => {
        const file = (request as unknown as { file?: Express.Multer.File }).file;
        if (!file) {
          problem(response, 400, 'invalid-file', 'Bad Request', 'No file was uploaded.');
          return;
        }
        response.json(
          await service.previewImport({
            originalname: file.originalname,
            size: file.size,
            buffer: file.buffer,
          }),
        );
      }),
    ],
    archiveTasks: [
      use,
      wrap(async (auth, request, response) => {
        response.json(
          await service.archiveMany(
            auth,
            request.body,
            request.header('x-request-id') ?? undefined,
          ),
        );
      }),
    ],
    importTasks: [
      use,
      wrap(async (auth, request, response) => {
        response
          .status(201)
          .json(
            await service.importTasks(
              auth,
              request.body,
              request.header('x-request-id') ?? undefined,
            ),
          );
      }),
    ],
  };
}
