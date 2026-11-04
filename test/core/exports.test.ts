import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('exports of src/index.ts', () => {
  it('the only runtime export is createConsentManager', async () => {
    const exported = await import('../../src/index.ts');

    assert.deepStrictEqual(Object.keys(exported), ['createConsentManager']);
  });
});

describe('import without side effects', () => {
  it('importing src/index.ts calls neither Date.now nor queueMicrotask', () => {
    // In a new process, the import evaluates every module, bypassing the cache, after both
    // globals are replaced by counters.
    const probe = [
      'let calls = 0;',
      'Date.now = () => { calls += 1; return 0; };',
      'globalThis.queueMicrotask = () => { calls += 1; };',
      `await import(${JSON.stringify(import.meta.resolve('../../src/index.ts'))});`,
      'process.stdout.write(String(calls));',
    ].join('\n');

    const { stdout, stderr } = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', probe],
      { encoding: 'utf8' },
    );

    assert.equal(stdout, '0', stderr);
  });
});
