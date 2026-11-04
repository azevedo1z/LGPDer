import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decisionOf, recordOf, serialized } from '../support/records.ts';
import { setup } from '../support/setup.ts';

describe('effective status from the configured version and the recorded decision', () => {
  const CASES = [
    {
      scenario: 'no decision, versioned purpose',
      config: { version: '1' },
      record: undefined,
      status: 'pending',
      outdated: false,
    },
    {
      scenario: 'no decision, unversioned purpose',
      config: {},
      record: undefined,
      status: 'pending',
      outdated: false,
    },
    {
      scenario: 'grant under the current version',
      config: { version: '1' },
      record: recordOf({ item: decisionOf('granted', { version: '1' }) }),
      status: 'granted',
      outdated: false,
    },
    {
      scenario: 'refusal under the current version',
      config: { version: '1' },
      record: recordOf({ item: decisionOf('denied', { version: '1' }) }),
      status: 'denied',
      outdated: false,
    },
    {
      scenario: 'grant without version in an unversioned purpose (absent and absent are equal)',
      config: {},
      record: recordOf({ item: decisionOf('granted') }),
      status: 'granted',
      outdated: false,
    },
    {
      scenario: 'refusal without version in an unversioned purpose',
      config: {},
      record: recordOf({ item: decisionOf('denied') }),
      status: 'denied',
      outdated: false,
    },
    {
      scenario: 'grant under a previous version',
      config: { version: '2' },
      record: recordOf({ item: decisionOf('granted', { version: '1' }) }),
      status: 'pending',
      outdated: true,
    },
    {
      scenario: 'refusal under a previous version',
      config: { version: '2' },
      record: recordOf({ item: decisionOf('denied', { version: '1' }) }),
      status: 'pending',
      outdated: true,
    },
    {
      scenario: "versions '10' and '9' are just different, without ordering",
      config: { version: '9' },
      record: recordOf({ item: decisionOf('granted', { version: '10' }) }),
      status: 'pending',
      outdated: true,
    },
    {
      scenario: 'versions compared by strict equality, without case normalization',
      config: { version: 'v1' },
      record: recordOf({ item: decisionOf('granted', { version: 'V1' }) }),
      status: 'pending',
      outdated: true,
    },
    {
      scenario: 'decision with version in an unversioned purpose',
      config: {},
      record: recordOf({ item: decisionOf('granted', { version: '1' }) }),
      status: 'pending',
      outdated: true,
    },
    {
      scenario: 'decision without version in a versioned purpose',
      config: { version: '1' },
      record: recordOf({ item: decisionOf('granted') }),
      status: 'pending',
      outdated: true,
    },
  ] as const;

  for (const { scenario, config, record, status, outdated } of CASES) {
    it(`${scenario}: '${status}', outdated ${String(outdated)}`, () => {
      const { consent } = setup({ purposes: { item: config }, record });

      const snapshot = consent.getSnapshot();

      assert.deepStrictEqual(
        { status: snapshot.status.item, outdated: snapshot.outdated.item },
        { status, outdated },
      );
    });
  }
});

describe('only granted authorizes, and only an explicit grant produces it', () => {
  const PATHS = [
    { path: 'creation without a record', consentAfter: () => setup().consent },
    {
      path: 'hydration of a grant without decidedAt',
      consentAfter: () =>
        setup({ record: '{"format":1,"decisions":{"ads":{"status":"granted"}}}' }).consent,
    },
    {
      path: 'hydration of a grant under another version',
      consentAfter: () =>
        setup({ record: recordOf({ analytics: decisionOf('granted', { version: '2025-01' }) }) })
          .consent,
    },
    {
      path: 'hydration of an expired grant',
      consentAfter: () =>
        setup({ record: recordOf({ ads: decisionOf('granted', { decidedAt: 0 }) }) }).consent,
    },
    {
      path: 'decide with denied',
      consentAfter: () => {
        const { consent } = setup();
        consent.decide({ analytics: 'denied', ads: 'denied' });
        return consent;
      },
    },
    {
      path: 'denyAll',
      consentAfter: () => {
        const { consent } = setup();
        consent.denyAll();
        return consent;
      },
    },
    {
      path: 'restore of an invalid record after grantAll',
      consentAfter: () => {
        const { consent } = setup();
        consent.grantAll();
        consent.restore('{"format":1,');
        return consent;
      },
    },
  ] as const;

  for (const { path, consentAfter } of PATHS) {
    it(`${path}: no purpose is granted`, () => {
      const consent = consentAfter();

      const statuses = Object.values(consent.getSnapshot().status);

      assert.equal(statuses.includes('granted'), false);
    });
  }
});

describe('snapshot keys in configuration order', () => {
  it('status and outdated list every configured purpose, in configuration order', () => {
    const { consent } = setup({
      purposes: { zeta: {}, alpha: { version: '1' }, mid: {} },
      record: recordOf({
        mid: decisionOf('granted'),
        alpha: decisionOf('denied', { version: '0' }),
      }),
    });

    const { status, outdated } = consent.getSnapshot();

    assert.deepStrictEqual(
      [Object.keys(status), Object.keys(outdated)],
      [
        ['zeta', 'alpha', 'mid'],
        ['zeta', 'alpha', 'mid'],
      ],
    );
  });

  it('record.decisions has only the decided purposes, current or outdated, in order', () => {
    const { consent } = setup({
      record: recordOf({
        health: decisionOf('granted', { version: '0' }),
        analytics: decisionOf('denied', { version: '2026-10' }),
      }),
    });

    const { decisions } = consent.getSnapshot().record;

    assert.deepStrictEqual(Object.keys(decisions), ['analytics', 'health']);
  });
});

describe('return to pending', () => {
  it('restore without a valid decision for the purpose takes it back to pending', () => {
    const { consent } = setup();
    consent.decide({ analytics: 'granted', ads: 'granted' });

    consent.restore(recordOf({ analytics: decisionOf('granted', { version: '2026-10' }) }));

    assert.equal(consent.getSnapshot().status.ads, 'pending');
  });

  it('restore of a decision recorded under another version takes the purpose back to pending, with outdated true', () => {
    const { consent } = setup();
    consent.decide({ analytics: 'granted' });

    consent.restore(recordOf({ analytics: decisionOf('granted', { version: '2025-01' }) }));

    const { status, outdated } = consent.getSnapshot();
    assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', true]);
  });
});

describe('outdated goes back to false when the outdated decision is replaced or removed', () => {
  /** analytics granted under the version before the one of the fixture: pending and outdated. */
  const STALE_ANALYTICS = recordOf({ analytics: decisionOf('granted', { version: '2025-01' }) });

  it('a new decision on the outdated purpose: granted, with outdated false', () => {
    const { consent } = setup({ record: STALE_ANALYTICS });

    consent.decide({ analytics: 'granted' });

    const { status, outdated } = consent.getSnapshot();
    assert.deepStrictEqual([status.analytics, outdated.analytics], ['granted', false]);
  });

  it('restore that removes the outdated decision: pending, with outdated false', () => {
    const { consent } = setup({ record: STALE_ANALYTICS });

    consent.restore(null);

    const { status, outdated } = consent.getSnapshot();
    assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', false]);
  });
});

describe('current version and outdated decisions', () => {
  it('the current version does not change during the lifetime of the instance, even if the configuration changes', () => {
    const analytics = { version: '1' };
    const { consent } = setup({ purposes: { analytics } });

    analytics.version = '2';
    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('granted', { version: '1' }),
    });
  });

  it('an outdated decision stays intact in the record, without becoming denied, until replaced', () => {
    const outdated = decisionOf('granted', { version: '2025-01' });
    const { consent } = setup({ record: recordOf({ analytics: outdated }) });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions.analytics, outdated);
  });

  it('the record uses format 1, whatever the versions of the purposes', () => {
    const { consent } = setup({ purposes: { analytics: { version: '2' } } });

    consent.decide({ analytics: 'granted' });

    assert.equal(consent.getSnapshot().record.format, 1);
  });
});

describe('version changed between deploys', () => {
  const NEXT_PURPOSES = { analytics: { version: '2026-11' } } as const;

  /** Record written by the previous deploy, which granted analytics in version 2026-10. */
  function previousDeployRecord(): string {
    const { consent } = setup({ purposes: { analytics: { version: '2026-10' } } });
    consent.decide({ analytics: 'granted' });
    return JSON.stringify(consent.getSnapshot().record);
  }

  it('the purpose is pending, with outdated true', () => {
    const { consent } = setup({ purposes: NEXT_PURPOSES, record: previousDeployRecord() });

    const { status, outdated } = consent.getSnapshot();

    assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', true]);
  });

  it('the previous decision is kept in the record', () => {
    const { consent } = setup({ purposes: NEXT_PURPOSES, record: previousDeployRecord() });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('granted', { version: '2026-10' }),
    });
  });

  it('a new decision with the same value records the new version and notifies', () => {
    const { consent, changes } = setup({
      purposes: NEXT_PURPOSES,
      record: previousDeployRecord(),
    });

    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(consent.getSnapshot().record.decisions, {
      analytics: decisionOf('granted', { version: '2026-11' }),
    });
    assert.equal(changes.length, 1);
  });
});

describe('configuration changes between deploys', () => {
  it('going back to the previous version makes the decisions recorded under it current again', () => {
    const first = setup({ purposes: { analytics: { version: '1' } } });
    first.consent.decide({ analytics: 'granted' });
    const second = setup({
      purposes: { analytics: { version: '2' } },
      record: JSON.stringify(first.consent.getSnapshot().record),
    });

    const third = setup({
      purposes: { analytics: { version: '1' } },
      record: JSON.stringify(second.consent.getSnapshot().record),
    });

    assert.equal(third.consent.getSnapshot().status.analytics, 'granted');
  });

  const VERSION_CHANGES = [
    {
      scenario: 'version removed: the decision with version becomes outdated',
      before: { version: '1' },
      after: {},
    },
    {
      scenario: 'version added: the decision without version becomes outdated',
      before: {},
      after: { version: '1' },
    },
  ] as const;

  for (const { scenario, before, after } of VERSION_CHANGES) {
    it(scenario, () => {
      const previous = setup({ purposes: { analytics: before } });
      previous.consent.decide({ analytics: 'granted' });

      const { consent } = setup({
        purposes: { analytics: after },
        record: JSON.stringify(previous.consent.getSnapshot().record),
      });

      const { status, outdated } = consent.getSnapshot();
      assert.deepStrictEqual([status.analytics, outdated.analytics], ['pending', true]);
    });
  }

  it('a new purpose starts pending, without outdated', () => {
    const { consent } = setup({
      purposes: { analytics: { version: '1' }, newsletter: {} },
      record: serialized({ analytics: decisionOf('granted', { version: '1' }) }),
    });

    const { status, outdated } = consent.getSnapshot();

    assert.deepStrictEqual([status.newsletter, outdated.newsletter], ['pending', false]);
  });

  it('the decision of a removed purpose is ignored and leaves the record to be written', () => {
    const { consent } = setup({
      purposes: { analytics: { version: '1' } },
      record: serialized({
        analytics: decisionOf('granted', { version: '1' }),
        legacy: decisionOf('granted'),
      }),
    });

    assert.equal(
      JSON.stringify(consent.getSnapshot().record),
      serialized({ analytics: decisionOf('granted', { version: '1' }) }),
    );
  });
});
