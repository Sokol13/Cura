import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRuntimeConfig } from '../src/runtime.js';

describe('standalone server configuration', () => {
  it('gives command line arguments priority over environment variables', () => {
    const configuration = readRuntimeConfig(
      ['--port', '4200', '--data-dir', './custom-data'],
      { PORT: '4100', CURA_DATA_DIR: './environment-data' },
    );
    expect(configuration.port).toBe(4200);
    expect(configuration.paths.data).toBe(resolve('./custom-data'));
  });

  it('uses environment variables and the documented default port', () => {
    expect(readRuntimeConfig([], {}).port).toBe(3000);
    const configuration = readRuntimeConfig([], {
      PORT: '3100',
      CURA_DATA_DIR: './environment-data',
    });
    expect(configuration.port).toBe(3100);
    expect(configuration.paths.data).toBe(resolve('./environment-data'));
  });

  it.each(['-1', '65536', 'not-a-port', '1.5', ''])(
    'rejects invalid port %s',
    (port) => {
      expect(() => readRuntimeConfig(['--port', port], {})).toThrow(/port/i);
    },
  );

  it('rejects unknown arguments', () => {
    expect(() => readRuntimeConfig(['--host', '0.0.0.0'], {})).toThrow();
  });
});
