import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('exports of src/scripts/index.ts', () => {
  it('the only runtime export is connectScripts', async () => {
    const exported = await import('../../src/scripts/index.ts');

    assert.deepStrictEqual(Object.keys(exported), ['connectScripts']);
  });

  it('importing it on the server reads no browser global and queues nothing', () => {
    // In a new process, each global is replaced by a counter before the import.
    const probe = [
      'let reads = 0;',
      "for (const name of ['window', 'document', 'location', 'console', 'queueMicrotask']) {",
      '  Object.defineProperty(globalThis, name, { configurable: true, get: () => { reads += 1; } });',
      '}',
      `await import(${JSON.stringify(import.meta.resolve('../../src/scripts/index.ts'))});`,
      'process.stdout.write(String(reads));',
    ].join('\n');

    const { stdout, stderr } = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', probe],
      { encoding: 'utf8' },
    );

    assert.equal(stdout, '0', stderr);
  });
});
