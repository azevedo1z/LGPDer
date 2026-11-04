import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createConsentManager } from 'lgpder';

describe('pacote compilado, importado pelo nome lgpder', () => {
  it('a única exportação de runtime é createConsentManager', async () => {
    const exported = await import('lgpder');

    assert.deepStrictEqual(Object.keys(exported), ['createConsentManager']);
  });

  it('executa o fluxo mínimo: criar, decidir e ler', () => {
    const consent = createConsentManager({
      purposes: { analytics: { version: '2026-10' }, ads: {} },
      now: () => 1_793_448_000_000,
    });

    consent.decide({ analytics: 'granted', ads: 'denied' });

    assert.deepStrictEqual(consent.getSnapshot().record, {
      format: 1,
      decisions: {
        analytics: { status: 'granted', version: '2026-10', decidedAt: 1_793_448_000_000 },
        ads: { status: 'denied', decidedAt: 1_793_448_000_000 },
      },
    });
  });
});
