import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { findProfileAccessByEmail } from '../../../../packages/db/src/profiles.js';
import type { AuthUser, LocalAuth } from './local-auth.js';

export type ApplicationAuth = {
  provider: string;
  subject: string;
  email: string;
  displayName: string;
  profileId: string;
  roles: string[];
  permissions: string[];
};

type AuthSource = {
  user: AuthUser;
  token: string;
};

function forbidden(response: Response): void {
  response.status(403).type('application/problem+json').json({
    type: 'urn:jackys-service-portal:errors:forbidden',
    title: 'Forbidden',
    status: 403,
    detail: 'The authenticated user does not have permission for this operation.',
  });
}

function unauthorized(response: Response): void {
  response.status(401).type('application/problem+json').json({
    type: 'urn:jackys-service-portal:errors:unauthorized',
    title: 'Unauthorized',
    status: 401,
    detail: 'A valid authentication token is required.',
  });
}

export function createApplicationAuth(pool: Pool, localAuth: LocalAuth | null) {
  async function resolve(request: Request, response: Response): Promise<ApplicationAuth | null> {
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;
    const source = token && localAuth ? await getLocalSource(token, localAuth) : null;
    if (!source) {
      unauthorized(response);
      return null;
    }

    if (source.user.mustChangePassword) {
      response.status(403).type('application/problem+json').json({
        type: 'urn:jackys-service-portal:errors:password-change-required',
        title: 'Password change required',
        status: 403,
        detail: 'Choose a new password before using the portal.',
      });
      return null;
    }

    const client = await pool.connect();
    let profile;
    try {
      profile = await findProfileAccessByEmail(client, source.user.email);
    } finally {
      client.release();
    }
    if (!profile || !profile.active) {
      unauthorized(response);
      return null;
    }

    const permissions = source.user.permissions.includes('*') ? ['*'] : profile.permissions;
    return {
      provider: 'local',
      subject: source.user.id,
      email: profile.email,
      displayName: profile.displayName,
      profileId: profile.id,
      roles: profile.roles,
      permissions,
    };
  }

  function requirePermission(permission: string) {
    return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
      const auth = await resolve(request, response);
      if (!auth) return;
      if (!auth.permissions.includes('*') && !auth.permissions.includes(permission)) {
        forbidden(response);
        return;
      }
      response.locals.auth = auth;
      next();
    };
  }

  return { requirePermission, resolve };
}

async function getLocalSource(token: string, localAuth: LocalAuth): Promise<AuthSource | null> {
  const user = await localAuth.getUserFromToken(token);
  return user ? { user, token } : null;
}

// The permissions a signed-in user really has right now: administrators keep
// '*', everyone else gets what the role matrix (role_permissions) grants their
// profile. /api/auth/me and sign-in use this so the screens match what the API
// will actually allow (modification.md #55).
export async function withEffectivePermissions(
  pool: Pool | null,
  user: AuthUser,
): Promise<AuthUser> {
  if (!pool || user.permissions.includes('*')) return user;
  const client = await pool.connect();
  try {
    const profile = await findProfileAccessByEmail(client, user.email);
    return { ...user, permissions: profile && profile.active ? profile.permissions : [] };
  } finally {
    client.release();
  }
}
