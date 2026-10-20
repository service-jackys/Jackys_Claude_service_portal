import type { RequestHandler } from 'express';
import { CHANGELOG } from './changelog-data.js';

// The portal's change history (built from modification.md by scripts/build-changelog.mjs).
// Administrator only: the same admin.users permission as Roles & permissions.
export function createChangelogHandlers(
  requirePermission: (permission: string) => RequestHandler,
): Record<string, RequestHandler[]> {
  return {
    list: [
      requirePermission('admin.users'),
      (_request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.json({ total: CHANGELOG.length, entries: CHANGELOG });
      },
    ],
  };
}
