import { expect, it } from 'vitest';
import { UploadQuerySchema } from '@cura/shared';

it('accepts portable Unicode names and rejects paths, device names and control characters', () => {
  expect(
    UploadQuerySchema.parse({ name: '角色-é.png'.normalize('NFD') }).name,
  ).toBe('角色-é.png');
  for (const name of [
    '../x.png',
    'C:\\x.png',
    'a\0.png',
    'CON',
    'nul.png',
    'aux.txt',
    'LPT1.png',
    'image?.png',
    'a:b.png',
    'image.',
  ]) {
    expect(UploadQuerySchema.safeParse({ name }).success, name).toBe(false);
  }
});
