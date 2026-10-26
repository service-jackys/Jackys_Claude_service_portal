import type { Response } from 'express';

// Live delivery for chat over Server-Sent Events. One entry per open browser tab.
// Events are small nudges ("something changed in conversation 12"); the screen then
// fetches the real data through the normal, permission-checked API, so the stream never
// carries anything a person could not already read.
//
// This hub lives in the memory of one API process. With several API instances behind a
// load balancer, clients still work (they fall back to polling) but would only get live
// events from the instance they are connected to; use a shared bus (Postgres
// LISTEN/NOTIFY or Redis) before scaling out.

export type ChatEvent = { type: string; data: Record<string, unknown> };

const clients = new Map<string, Set<Response>>();
let heartbeat: NodeJS.Timeout | null = null;

function write(response: Response, event: ChatEvent): void {
  try {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  } catch {
    /* the close handler removes dead connections */
  }
}

export function onlineProfileIds(): string[] {
  return [...clients.keys()];
}

export function sendToProfile(profileId: string, event: ChatEvent): void {
  for (const response of clients.get(profileId) ?? []) write(response, event);
}

export function sendToProfiles(
  profileIds: Iterable<string>,
  event: ChatEvent | ((profileId: string) => ChatEvent),
): void {
  for (const profileId of new Set(profileIds))
    sendToProfile(profileId, typeof event === 'function' ? event(profileId) : event);
}

export function broadcast(event: ChatEvent): void {
  for (const profileId of clients.keys()) sendToProfile(profileId, event);
}

export function connect(profileId: string, response: Response): void {
  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
  const wasOnline = clients.has(profileId);
  const set = clients.get(profileId) ?? new Set<Response>();
  set.add(response);
  clients.set(profileId, set);
  write(response, { type: 'hello', data: { online: onlineProfileIds() } });
  if (!wasOnline) broadcast({ type: 'presence', data: { profileId, online: true } });
  if (!heartbeat) {
    heartbeat = setInterval(() => {
      for (const set of clients.values()) for (const res of set) res.write(': keep-alive\n\n');
    }, 25000);
    heartbeat.unref();
  }
  response.on('close', () => {
    set.delete(response);
    if (!set.size) {
      clients.delete(profileId);
      broadcast({ type: 'presence', data: { profileId, online: false } });
    }
    if (!clients.size && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  });
}
