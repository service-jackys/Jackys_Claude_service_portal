import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  countLocalAuthUsers,
  findLocalAuthUserByEmail,
  findLocalAuthUserById,
  insertLocalAuthUser,
  listLocalAuthUsers,
  updateLocalAuthUser,
  type LocalAuthUserRecord,
} from '../../../../packages/db/src/local-auth-users.js';

const scryptAsync = promisify(scrypt);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const localRoles = ['user', 'sales', 'management', 'admin'] as const;
export type LocalRole = (typeof localRoles)[number];

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: LocalRole;
  permissions: readonly string[];
  active: boolean;
};

type Session = {
  userId: string;
  expiresAt: number;
};

const rolePermissions: Record<LocalRole, readonly string[]> = {
  user: ['dashboard.read'],
  sales: ['dashboard.read', 'quotation.read', 'quotation.write'],
  management: ['dashboard.read', 'reports.read'],
  admin: ['*'],
};

export const bootstrapSchema = z
  .object({
    bootstrapToken: z.string().min(32).max(256),
    email: z.string().email().max(320),
    name: z.string().trim().min(1).max(120),
    password: z.string().min(12).max(200),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().email().max(320),
    password: z.string().min(1).max(200),
  })
  .strict();

// Lets an already-authenticated admin add another local-auth user (see
// modification.md #10) -- bootstrap only ever creates the first admin, and
// there's no other route to add teammates. Role decides the effective
// permission set: 'admin' gets the same '*' shortcut bootstrap gets,
// everything else defers to whatever the matching DB profile/role grants
// (see application-auth.ts's resolve()).
export const createUserSchema = z
  .object({
    email: z.string().email().max(320),
    name: z.string().trim().min(1).max(120),
    password: z.string().min(12).max(200),
    role: z.enum(localRoles),
  })
  .strict();

// A Team-logins edit (see modification.md #13) -- change a teammate's role
// and/or turn their login on or off. At least one of the two, so an empty
// PATCH isn't silently a no-op that still returns 200.
export const updateUserSchema = z
  .object({
    role: z.enum(localRoles).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.role !== undefined || value.active !== undefined, {
    message: 'Provide a role and/or active to update.',
  });

type LocalAuthOptions = {
  bootstrapToken?: string;
};

export type LocalAuth = ReturnType<typeof createLocalAuth>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function tokensMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(hashToken(provided), hashToken(expected));
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;

  const expected = Buffer.from(keyHex, 'hex');
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publicUser(user: LocalAuthUserRecord): AuthUser {
  const role = user.role as LocalRole;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    permissions: rolePermissions[role],
    active: user.active,
  };
}

// Team logins (see modification.md #20) are stored in the local_auth_users
// table, not in process memory -- until this, they were a plain JS Map that
// reset to empty on every `npm run dev` restart, which is why a teammate
// login (and any role/active change saved for it) kept disappearing. Only
// the sign-in session itself (the `sessions` map below) stays in-memory on
// purpose: signing out on every restart is normal, losing your whole
// teammate list and its roles is not.
export function createLocalAuth(options: LocalAuthOptions, pool: Pool) {
  const sessions = new Map<string, Session>();

  function createSession(user: AuthUser): { token: string; user: AuthUser } {
    const token = randomBytes(32).toString('base64url');
    sessions.set(hashToken(token).toString('hex'), {
      userId: user.id,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return { token, user };
  }

  async function getUserFromToken(token: string): Promise<AuthUser | null> {
    const sessionKey = hashToken(token).toString('hex');
    const session = sessions.get(sessionKey);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(sessionKey);
      return null;
    }

    const client = await pool.connect();
    try {
      const user = await findLocalAuthUserById(client, session.userId);
      return user && user.active ? publicUser(user) : null;
    } finally {
      client.release();
    }
  }

  function revokeToken(token: string): void {
    sessions.delete(hashToken(token).toString('hex'));
  }

  async function listUsers(): Promise<AuthUser[]> {
    const client = await pool.connect();
    try {
      return (await listLocalAuthUsers(client)).map(publicUser);
    } finally {
      client.release();
    }
  }

  async function createUser(input: unknown) {
    const data = createUserSchema.parse(input);
    const email = normalizeEmail(data.email);
    const client = await pool.connect();
    try {
      if (await findLocalAuthUserByEmail(client, email)) {
        return { kind: 'email-taken' as const };
      }
      const user = await insertLocalAuthUser(client, {
        email,
        name: data.name,
        role: data.role,
        passwordHash: await hashPassword(data.password),
      });
      return { kind: 'created' as const, user: publicUser(user) };
    } finally {
      client.release();
    }
  }

  async function updateUser(id: string, input: unknown) {
    const data = updateUserSchema.parse(input);
    const client = await pool.connect();
    try {
      const user = await updateLocalAuthUser(client, id, data);
      if (!user) return { kind: 'not-found' as const };
      return { kind: 'updated' as const, user: publicUser(user) };
    } finally {
      client.release();
    }
  }

  async function bootstrap(input: unknown) {
    const data = bootstrapSchema.parse(input);
    const client = await pool.connect();
    try {
      if ((await countLocalAuthUsers(client)) > 0) {
        return { kind: 'unavailable' as const };
      }
      if (!options.bootstrapToken || !tokensMatch(data.bootstrapToken, options.bootstrapToken)) {
        return { kind: 'invalid-token' as const };
      }

      const user = await insertLocalAuthUser(client, {
        email: normalizeEmail(data.email),
        name: data.name,
        role: 'admin',
        passwordHash: await hashPassword(data.password),
      });
      return { kind: 'created' as const, ...createSession(publicUser(user)) };
    } finally {
      client.release();
    }
  }

  async function login(input: unknown) {
    const data = loginSchema.parse(input);
    const client = await pool.connect();
    try {
      const user = await findLocalAuthUserByEmail(client, normalizeEmail(data.email));
      if (!user || !user.active || !(await verifyPassword(data.password, user.passwordHash))) {
        return { kind: 'invalid-credentials' as const };
      }
      return { kind: 'authenticated' as const, ...createSession(publicUser(user)) };
    } finally {
      client.release();
    }
  }

  async function requireAuth(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;
    const user = token ? await getUserFromToken(token) : null;

    if (!user) {
      response.status(401).type('application/problem+json').json({
        type: 'urn:jackys-service-portal:errors:unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail: 'A valid authentication token is required.',
      });
      return;
    }

    response.locals.auth = { token, user };
    next();
  }

  function requirePermission(permission: string) {
    return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
      await requireAuth(request, response, () => {
        const user = response.locals.auth.user as AuthUser;
        if (!user.permissions.includes('*') && !user.permissions.includes(permission)) {
          response.status(403).type('application/problem+json').json({
            type: 'urn:jackys-service-portal:errors:forbidden',
            title: 'Forbidden',
            status: 403,
            detail: 'The authenticated user does not have permission for this operation.',
          });
          return;
        }
        next();
      });
    };
  }

  return {
    bootstrap,
    login,
    createUser,
    updateUser,
    listUsers,
    requireAuth,
    requirePermission,
    getUserFromToken,
    revokeToken,
  };
}

export function getLocalRolePermissions(role: LocalRole): readonly string[] {
  return rolePermissions[role];
}
