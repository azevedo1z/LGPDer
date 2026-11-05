import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('exports of src/ui/index.ts', () => {
  it('the runtime exports are createPlaceholder, mountUi and ptBR', async () => {
    const exported = await import('../../src/ui/index.ts');

    assert.deepStrictEqual(Object.keys(exported), ['createPlaceholder', 'mountUi', 'ptBR']);
  });

  it('importing it on the server reads no browser global, defines nothing and queues nothing', () => {
    // In a new process, each global is replaced by a counter before the import.
    const probe = [
      'let reads = 0;',
      'const names = ["window", "document", "location", "customElements", "HTMLElement",',
      '  "console", "queueMicrotask"];',
      'for (const name of names) {',
      '  Object.defineProperty(globalThis, name, { configurable: true, get: () => { reads += 1; } });',
      '}',
      `await import(${JSON.stringify(import.meta.resolve('../../src/ui/index.ts'))});`,
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
