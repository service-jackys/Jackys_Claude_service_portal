import type { RequestHandler, Response } from 'express';
import multer from 'multer';
import { MAX_ATTACHMENT_BYTES } from '../attachments/storage.js';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { connect } from './hub.js';
import { ChatServiceError, type ChatService } from './service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
});

function fail(error: unknown, response: Response): boolean {
  if (!(error instanceof ChatServiceError)) return false;
  if (error.code === 'not-found') problem(response, 404, 'not-found', 'Not Found', error.message);
  else if (error.code === 'forbidden')
    problem(response, 403, 'forbidden', 'Forbidden', error.message);
  else problem(response, 400, 'invalid', 'Bad Request', error.message);
  return true;
}

export function createChatHandlers(
  service: ChatService,
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  const use = requirePermission('chat.use');
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
  const id = (request: Parameters<RequestHandler>[0]) => String(request.params.id);
  const requestId = (request: Parameters<RequestHandler>[0]) =>
    String(request.header('x-request-id') ?? '') || undefined;

  return {
    people: [
      use,
      wrap(async (auth, _r, res) => void res.json({ people: await service.people(auth) })),
    ],
    conversations: [
      use,
      wrap(async (auth, _r, res) => void res.json(await service.conversations(auth))),
    ],
    summary: [use, wrap(async (auth, _r, res) => void res.json(await service.summary(auth)))],
    open: [
      use,
      wrap(async (auth, req, res) => {
        res.json(await service.openConversation(auth, req.body, requestId(req)));
      }),
    ],
    details: [
      use,
      wrap(async (auth, req, res) => void res.json(await service.details(auth, id(req)))),
    ],
    messages: [
      use,
      wrap(async (auth, req, res) => {
        res.json({ messages: await service.messages(auth, id(req), req.query) });
      }),
    ],
    send: [
      use,
      wrap(async (auth, req, res) => {
        res
          .status(201)
          .json({ message: await service.send(auth, id(req), req.body, requestId(req)) });
      }),
    ],
    read: [
      use,
      wrap(async (auth, req, res) => {
        await service.read(auth, id(req), req.body);
        res.status(204).end();
      }),
    ],
    answer: [
      use,
      wrap(async (auth, req, res) => {
        res.json({ message: await service.answer(auth, id(req)) });
      }),
    ],
    pins: [
      use,
      wrap(async (auth, req, res) => {
        res.json({ messages: await service.pins(auth, id(req)) });
      }),
    ],
    edit: [
      use,
      wrap(async (auth, req, res) => {
        res.json({ message: await service.edit(auth, id(req), req.body, requestId(req)) });
      }),
    ],
    remove: [
      use,
      wrap(async (auth, req, res) => {
        res.json({ message: await service.remove(auth, id(req), requestId(req)) });
      }),
    ],
    react: [
      use,
      wrap(async (auth, req, res) => {
        res.json({ message: await service.react(auth, id(req), req.body) });
      }),
    ],
    pin: [
      use,
      wrap(async (auth, req, res) => {
        res.json({ message: await service.pin(auth, id(req), req.body, requestId(req)) });
      }),
    ],
    search: [
      use,
      wrap(async (auth, req, res) => {
        res.json({ results: await service.search(auth, req.query) });
      }),
    ],
    upload: [
      use,
      upload.single('file'),
      wrap(async (auth, req, res) => {
        const file = (req as unknown as { file?: Express.Multer.File }).file;
        if (!file) {
          problem(res, 400, 'invalid', 'Bad Request', 'No file was uploaded.');
          return;
        }
        res.status(201).json({
          attachment: await service.uploadAttachment(
            auth,
            id(req),
            {
              originalname: file.originalname,
              mimetype: file.mimetype,
              size: file.size,
              buffer: file.buffer,
            },
            requestId(req),
          ),
        });
      }),
    ],
    // No bearer token: authorised by the signed token in the query string.
    download: [
      async (req, res, next) => {
        try {
          const { file, buffer } = await service.downloadAttachment(
            String(req.params.id),
            String(req.query.token ?? ''),
            String(req.query.expires ?? ''),
          );
          res.setHeader('Content-Type', file.contentType);
          res.setHeader('Content-Length', String(buffer.length));
          res.setHeader(
            'Content-Disposition',
            `inline; filename="${file.fileName.replace(/["\\\r\n]/g, '')}"`,
          );
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cache-Control', 'private, max-age=300');
          res.send(buffer);
        } catch (error) {
          if (fail(error, res)) return;
          next(error);
        }
      },
    ],
    // Live events (Server-Sent Events). Sent with the normal Authorization header.
    stream: [
      use,
      wrap(async (auth, _req, res) => {
        connect(auth.profileId, res);
      }),
    ],
    presence: [
      use,
      wrap(async (_auth, _req, res) => void res.json({ online: service.presence() })),
    ],
    typing: [
      use,
      wrap(async (auth, req, res) => {
        await service.typing(auth, id(req));
        res.status(204).end();
      }),
    ],
    reads: [
      use,
      wrap(async (auth, req, res) => {
        res.json({ reads: await service.reads(auth, id(req)) });
      }),
    ],
    mute: [
      use,
      wrap(async (auth, req, res) => {
        await service.mute(auth, id(req), req.body);
        res.status(204).end();
      }),
    ],
    addMembers: [
      use,
      wrap(async (auth, req, res) => {
        res.json(await service.addMembers(auth, id(req), req.body, requestId(req)));
      }),
    ],
    leave: [
      use,
      wrap(async (auth, req, res) => {
        await service.leave(auth, id(req));
        res.status(204).end();
      }),
    ],
  };
}
