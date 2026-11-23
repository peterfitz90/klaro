import { expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ fpaClient: () => { throw new Error('not used'); } }));
const { DbError } = await import('./db');
const { AppError, userMessage } = await import('./errors');

it('maps codes to messages a user can act on', () => {
  expect(userMessage(new DbError('read plans', { message: 'permission denied for schema fpa', code: '42501' }))).toBe('You do not have access to this.');
  expect(userMessage(new DbError('create entity', { message: 'You already own 10 entities, the most allowed', code: 'PT429' })))
    .toBe('You already own 10 entities, the most allowed');
  expect(userMessage(new AppError('Klaro is not configured'))).toBe('Klaro is not configured');
  expect(userMessage('odd')).toBe('Something went wrong.');
});
