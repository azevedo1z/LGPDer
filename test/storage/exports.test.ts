import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('exports of src/storage/index.ts', () => {
  it('the runtime exports are connectStorage, cookieAdapter and localStorageAdapter', async () => {
    const exported = await import('../../src/storage/index.ts');

    assert.deepStrictEqual(Object.keys(exported), [
      'connectStorage',
      'cookieAdapter',
      'localStorageAdapter',
    ]);
  });

  it('importing it on the server reads no browser global', () => {
    // In a new process, each global is replaced by a counter before the import.
    const probe = [
      'let reads = 0;',
      "for (const name of ['window', 'document', 'localStorage', 'location', 'BroadcastChannel']) {",
      '  Object.defineProperty(globalThis, name, { configurable: true, get: () => { reads += 1; } });',
      '}',
      `await import(${JSON.stringify(import.meta.resolve('../../src/storage/index.ts'))});`,
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
