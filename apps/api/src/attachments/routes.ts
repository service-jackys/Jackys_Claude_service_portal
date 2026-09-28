import type { RequestHandler } from 'express';
import multer from 'multer';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { AttachmentServiceError, type AttachmentService } from './service.js';
import { MAX_ATTACHMENT_BYTES } from './storage.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
});

function serviceError(error: unknown, response: Parameters<RequestHandler>[1]): void {
  if (!(error instanceof AttachmentServiceError)) throw error;
  const status = error.code === 'not-found' ? 404 : 400;
  problem(
    response,
    status,
    error.code,
    status === 404 ? 'Not Found' : 'Bad Request',
    error.message,
  );
}

export function createAttachmentHandlers(
  service: AttachmentService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    upload: [
      requirePermission('service_job_card.write'),
      upload.single('file'),
      async (request, response, next) => {
        try {
          const file = (request as unknown as { file?: Express.Multer.File }).file;
          if (!file) {
            problem(response, 400, 'invalid-file', 'Bad Request', 'No file was uploaded.');
            return;
          }
          const auth = response.locals.auth as ApplicationAuth;
          response.status(201).json({
            attachment: await service.upload(
              String(request.params.jobCardId),
              {
                originalname: file.originalname,
                mimetype: file.mimetype,
                size: file.size,
                buffer: file.buffer,
              },
              auth.profileId,
              request.header('x-request-id') ?? undefined,
            ),
          });
        } catch (error) {
          if (error instanceof AttachmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    list: [
      requirePermission('service_job_card.read'),
      async (request, response, next) => {
        try {
          response.json({ attachments: await service.list(String(request.params.jobCardId)) });
        } catch (error) {
          if (error instanceof AttachmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    // Not behind requirePermission -- this is the signed-URL download route,
    // authorized by the token+expiry query parameters instead of a bearer
    // token, so it can be used as a plain <img src> / <a href>.
    download: [
      async (request, response, next) => {
        try {
          const { buffer, attachment } = await service.download(
            String(request.params.id),
            String(request.query.token ?? ''),
            String(request.query.expires ?? ''),
          );
          response.setHeader('Content-Type', attachment.contentType);
          response.setHeader('Content-Length', String(buffer.length));
          response.setHeader(
            'Content-Disposition',
            `inline; filename="${attachment.fileName.replaceAll('"', '')}"`,
          );
          response.setHeader('Cache-Control', 'private, max-age=60');
          response.send(buffer);
        } catch (error) {
          if (error instanceof AttachmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
    remove: [
      requirePermission('service_job_card.write'),
      async (request, response, next) => {
        try {
          const auth = response.locals.auth as ApplicationAuth;
          await service.remove(
            String(request.params.id),
            auth.profileId,
            request.header('x-request-id') ?? undefined,
          );
          response.status(204).send();
        } catch (error) {
          if (error instanceof AttachmentServiceError) {
            serviceError(error, response);
            return;
          }
          next(error);
        }
      },
    ],
  };
}
