import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('exports of src/google/index.ts', () => {
  it('the runtime exports are connectGoogle and consentDefaultSnippet', async () => {
    const exported = await import('../../src/google/index.ts');

    assert.deepStrictEqual(Object.keys(exported), ['connectGoogle', 'consentDefaultSnippet']);
    assert.equal(typeof exported.consentDefaultSnippet, 'string');
  });

  it('importing it on the server reads no browser global and queues nothing', () => {
    // In a new process, each global is replaced by a counter before the import.
    const probe = [
      'let reads = 0;',
      "for (const name of ['window', 'document', 'console', 'queueMicrotask']) {",
      '  Object.defineProperty(globalThis, name, { configurable: true, get: () => { reads += 1; } });',
      '}',
      `await import(${JSON.stringify(import.meta.resolve('../../src/google/index.ts'))});`,
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
