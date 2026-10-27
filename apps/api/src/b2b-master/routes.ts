import type { RequestHandler } from 'express';
import multer from 'multer';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { B2bMasterServiceError, MAX_B2B_FILE_BYTES, type B2bMasterService } from './service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_B2B_FILE_BYTES, files: 1 },
});

export function createB2bMasterHandlers(
  service: B2bMasterService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    upload: [
      requirePermission('b2b_master.write'),
      upload.single('file'),
      async (request, response, next) => {
        try {
          const file = (request as unknown as { file?: Express.Multer.File }).file;
          if (!file) {
            problem(response, 400, 'invalid-file', 'Bad Request', 'No file was uploaded.');
            return;
          }
          const auth = response.locals.auth as ApplicationAuth;
          const result = await service.upload(
            { originalname: file.originalname, size: file.size, buffer: file.buffer },
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response.status(201).json({ upload: result });
        } catch (error) {
          if (error instanceof B2bMasterServiceError) {
            problem(response, 400, error.code, 'Bad Request', error.message);
            return;
          }
          next(error);
        }
      },
    ],
    download: [
      requirePermission('b2b_master.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          const file = await service.download(
            auth.profileId,
            { original: request.query.source === 'upload' },
            request.header('x-request-id') ?? undefined,
          );
          response
            .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            .set('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`)
            .set('X-Download-Source', file.source)
            .set('Cache-Control', 'no-store')
            .send(file.buffer);
        } catch (error) {
          if (error instanceof B2bMasterServiceError) {
            problem(
              response,
              error.code === 'no-data' ? 404 : 400,
              error.code,
              error.code === 'no-data' ? 'Not Found' : 'Bad Request',
              error.message,
            );
            return;
          }
          next(error);
        }
      },
    ],
    status: [
      requirePermission('b2b_master.write'),
      async (_request, response, next) => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          response.json(await service.status());
        } catch (error) {
          next(error);
        }
      },
    ],
  };
}
