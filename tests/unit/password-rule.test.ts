import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUserSchema, isStrongPassword } from '../../apps/api/src/auth/local-auth.js';

test('password rule: 10+ chars, capital first, number and symbol', () => {
  assert.equal(isStrongPassword('Welcome@123'), true);
  assert.equal(isStrongPassword('Abcdefg#1x'), true);
  assert.equal(isStrongPassword('Short#1'), false); // too short
  assert.equal(isStrongPassword('welcome@1234'), false); // first letter not capital
  assert.equal(isStrongPassword('1Welcome@12'), false); // first char not a letter
  assert.equal(isStrongPassword('Welcome@Abc'), false); // no number
  assert.equal(isStrongPassword('Welcome12345'), false); // no symbol
});

test('create-user schema enforces the password rule', () => {
  const base = { email: 'a@b.co', name: 'A', role: 'user' as const };
  assert.equal(createUserSchema.safeParse({ ...base, password: 'Welcome@123' }).success, true);
  assert.equal(createUserSchema.safeParse({ ...base, password: 'welcome@123' }).success, false);
});
