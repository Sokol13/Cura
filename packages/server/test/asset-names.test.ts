import { describe, expect, it } from 'vitest';
import * as C from '@cura/shared';

describe('portable catalog display names', () => {
  it('normalizes manual labels and rejects reserved names and path characters', () => {
    expect(C.DisplayNameSchema.parse('  角色-e\u0301.png  ')).toBe(
      '角色-é.png',
    );
    for (const name of [
      '../a.png',
      'a/b.png',
      'CON.jpg',
      'LPT².png',
      'a.',
      'a\u0000.png',
    ])
      expect(C.DisplayNameSchema.safeParse(name).success).toBe(false);
    expect(
      C.assetDisplayName({ name: 'original.png', displayName: null }),
    ).toBe('original.png');
    expect(
      C.assetDisplayName({ name: 'original.png', displayName: 'Hero.png' }),
    ).toBe('Hero.png');
  });

  it('keeps each historical extension when a current label uses another format', () => {
    expect(C.versionExportName('Hero.png', 'old.JPG')).toBe('Hero.JPG');
    expect(C.versionExportName('角色-é.png'.normalize('NFD'), 'old.mov')).toBe(
      '角色-é.mov',
    );
    expect(C.versionExportName(null, 'COM¹.png')).toBe('_COM¹.png');
    const long = C.versionExportName('角色'.repeat(200) + '.png', 'old.jpeg');
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(255);
    expect(long.endsWith('.jpeg')).toBe(true);
  });

  it('makes automatic collision handling deterministic and case insensitive', () => {
    expect(
      C.proposeDisplayName('Portrait.png', 'original.jpg', [
        'portrait.jpg',
        'Portrait (2).jpg',
      ]),
    ).toBe('Portrait (3).jpg');
    expect(C.proposeDisplayName('../CON', 'original.png')).not.toMatch(/[\\/]/);
    expect(
      C.DisplayNameSchema.safeParse(C.proposeDisplayName('CON', 'original.png'))
        .success,
    ).toBe(true);
  });
});
