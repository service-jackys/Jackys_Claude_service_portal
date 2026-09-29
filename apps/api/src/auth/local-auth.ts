import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

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
};

type LocalUser = AuthUser & {
  passwordHash: string;
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

function publicUser(user: LocalUser): AuthUser {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export function createLocalAuth(options: LocalAuthOptions) {
  const users = new Map<string, LocalUser>();
  const sessions = new Map<string, Session>();
  let bootstrapConsumed = false;

  function createSession(user: LocalUser): { token: string; user: AuthUser } {
    const token = randomBytes(32).toString('base64url');
    sessions.set(hashToken(token).toString('hex'), {
      userId: user.id,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return { token, user: publicUser(user) };
  }

  function getUserFromToken(token: string): AuthUser | null {
    const sessionKey = hashToken(token).toString('hex');
    const session = sessions.get(sessionKey);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(sessionKey);
      return null;
    }

    const user = users.get(session.userId);
    return user ? publicUser(user) : null;
  }

  function revokeToken(token: string): void {
    sessions.delete(hashToken(token).toString('hex'));
  }

  function listUsers(): AuthUser[] {
    return [...users.values()].map(publicUser);
  }

  async function createUser(input: unknown) {
    const data = createUserSchema.parse(input);
    const email = normalizeEmail(data.email);
    if ([...users.values()].some((candidate) => candidate.email === email)) {
      return { kind: 'email-taken' as const };
    }
    const user: LocalUser = {
      id: randomBytes(16).toString('hex'),
      email,
      name: data.name,
      role: data.role,
      permissions: rolePermissions[data.role],
      passwordHash: await hashPassword(data.password),
    };
    users.set(user.id, user);
    return { kind: 'created' as const, user: publicUser(user) };
  }

  async function bootstrap(input: unknown) {
    const data = bootstrapSchema.parse(input);
    if (bootstrapConsumed || users.size > 0) {
      return { kind: 'unavailable' as const };
    }
    if (!options.bootstrapToken || !tokensMatch(data.bootstrapToken, options.bootstrapToken)) {
      return { kind: 'invalid-token' as const };
    }

    const user: LocalUser = {
      id: randomBytes(16).toString('hex'),
      email: normalizeEmail(data.email),
      name: data.name,
      role: 'admin',
      permissions: rolePermissions.admin,
      passwordHash: await hashPassword(data.password),
    };
    users.set(user.id, user);
    bootstrapConsumed = true;
    return { kind: 'created' as const, ...createSession(user) };
  }

  async function login(input: unknown) {
    const data = loginSchema.parse(input);
    const user = [...users.values()].find(
      (candidate) => candidate.email === normalizeEmail(data.email),
    );
    if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
      return { kind: 'invalid-credentials' as const };
    }
    return { kind: 'authenticated' as const, ...createSession(user) };
  }

  function requireAuth(request: Request, response: Response, next: NextFunction): void {
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;
    const user = token ? getUserFromToken(token) : null;

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
    return (request: Request, response: Response, next: NextFunction): void => {
      requireAuth(request, response, () => {
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
