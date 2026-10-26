import type { RequestHandler, Response } from 'express';
import type { ApplicationAuth } from '../auth/application-auth.js';
import { problem } from '../api/problem.js';
import { ChatServiceError, type ChatService } from './service.js';

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
