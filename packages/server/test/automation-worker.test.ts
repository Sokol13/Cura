import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { runAutomationWorker } from '../src/automation/worker-client.js';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
describe('bounded automation image workers', () => {
  it('normalizes real source pixels to bounded PNG and rejects escaping symlinks at execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cura-ai-worker-'));
    dirs.push(root);
    const bytes = await sharp({
      create: { width: 1024, height: 768, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    await writeFile(join(root, 'image.png'), bytes);
    const signal = new AbortController().signal;
    const result = Buffer.from(
      await runAutomationWorker<Uint8Array>(
        { op: 'image', root, relativePath: 'image.png' },
        signal,
      ),
    );
    const meta = await sharp(result).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([512, 384, 'png']);
    const outside = await mkdtemp(join(tmpdir(), 'cura-ai-outside-'));
    dirs.push(outside);
    await writeFile(join(outside, 'secret.png'), bytes);
    await symlink(join(outside, 'secret.png'), join(root, 'escape.png'));
    await expect(
      runAutomationWorker(
        { op: 'image', root, relativePath: 'escape.png' },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'AUTOMATION_FAILED' });
  });
  it('rejects changed immutable source bytes before analysis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cura-ai-integrity-'));
    dirs.push(root);
    await writeFile(join(root, 'source.txt'), 'SCENE: changed');
    await expect(
      runAutomationWorker(
        {
          op: 'read-script',
          root,
          relativePath: 'source.txt',
          expectedHash: '0'.repeat(64),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  });
  it('terminates work when cancelled without returning a late result', async () => {
    const controller = new AbortController();
    const pending = runAutomationWorker(
      { op: 'script', bytes: Buffer.from('INT. HOUSE\n') },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
