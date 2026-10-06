import type { RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import {
  MAX_STOCK_FILE_BYTES,
  StockMasterServiceError,
  type StockMasterService,
} from './service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_STOCK_FILE_BYTES, files: 1 },
});

export function createStockMasterHandlers(
  service: StockMasterService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    upload: [
      requirePermission('stock.write'),
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
            (request.body as { channel?: unknown } | undefined)?.channel,
            { originalname: file.originalname, size: file.size, buffer: file.buffer },
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response.status(201).json({ upload: result });
        } catch (error) {
          if (error instanceof StockMasterServiceError) {
            problem(response, 400, error.code, 'Bad Request', error.message);
            return;
          }
          next(error);
        }
      },
    ],
    status: [
      requirePermission('stock.write'),
      async (_request, response, next) => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          response.json(await service.status());
        } catch (error) {
          next(error);
        }
      },
    ],
    search: [
      requirePermission('stock.read'),
      async (request, response, next) => {
        try {
          response.setHeader('Cache-Control', 'no-store');
          response.json(await service.search(request.query));
        } catch (error) {
          if (error instanceof ZodError) {
            problem(response, 400, 'invalid-query', 'Bad Request', 'Invalid search query.');
            return;
          }
          next(error);
        }
      },
    ],
  };
}
