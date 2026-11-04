import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('exportações de src/index.ts', () => {
  it('a única exportação de runtime é createConsentManager', async () => {
    const exported = await import('../src/index.ts');

    assert.deepStrictEqual(Object.keys(exported), ['createConsentManager']);
  });
});

describe('importação sem efeito colateral', () => {
  it('importar src/index.ts não chama Date.now nem queueMicrotask', () => {
    // Num processo novo, a importação avalia todos os módulos, sem passar pelo cache, depois de os
    // dois globais serem trocados por contadores.
    const probe = [
      'let calls = 0;',
      'Date.now = () => { calls += 1; return 0; };',
      'globalThis.queueMicrotask = () => { calls += 1; };',
      `await import(${JSON.stringify(import.meta.resolve('../src/index.ts'))});`,
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
