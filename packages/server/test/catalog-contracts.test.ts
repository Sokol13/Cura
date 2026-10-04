import { describe, expect, it } from 'vitest';
import * as shared from '@cura/shared';

describe('catalog contracts', () => {
  it('publishes strict query and exact generation metadata contracts', () => {
    expect(shared).toHaveProperty('AssetQuerySchema');
    expect(shared).toHaveProperty('GenerationSchema');
  });
});
