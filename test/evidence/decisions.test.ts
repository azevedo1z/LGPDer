/**
 * Which changes are evidence: only the ones of source 'decision', reported to onDecision and sent
 * to the endpoint once each. Restoring and hydrating are never an expression of the data subject.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { ConsentChange } from 'lgpder';

import { captureMicrotasks } from '../support/capture.ts';
import { testDom } from '../support/dom.ts';
import {
  ENDPOINT,
  closeEvidences,
  connectEvidenceTo,
  installNetwork,
  openEvidence,
  type EvidencePage,
} from '../support/evidence.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { setup, type PurposeId } from '../support/setup.ts';

afterEach(() => {
  closeEvidences();
  testDom.reset();
});

/** Records the changes passed to `onDecision`, in order. */
function decisionRecorder(): {
  readonly reported: ConsentChange<PurposeId>[];
  readonly onDecision: (change: ConsentChange<PurposeId>) => void;
} {
  const reported: ConsentChange<PurposeId>[] = [];
  return {
    reported,
    onDecision: (change) => {
      reported.push(change);
    },
  };
}

describe('changes of source decision', () => {
  const OPERATIONS: readonly {
    readonly name: string;
    readonly act: (page: EvidencePage) => void;
  }[] = [
    {
      name: 'decide',
      act: ({ consent }) => {
        consent.decide({ ads: 'granted' });
      },
    },
    {
      name: 'grantAll',
      act: ({ consent }) => {
        consent.grantAll();
      },
    },
    {
      name: 'denyAll',
      act: ({ consent }) => {
        consent.denyAll();
      },
    },
  ];

  for (const { name, act } of OPERATIONS) {
    it(`${name} is reported to onDecision with the very change notified`, () => {
      const { reported, onDecision } = decisionRecorder();
      const page = openEvidence({ onDecision });

      act(page);

      assert.equal(reported.length, 1);
      assert.equal(reported[0], page.changes[0]);
      assert.equal(reported[0]?.source, 'decision');
    });

    it(`${name} is sent to the endpoint once`, (t) => {
      const network = installNetwork(t);
      const page = openEvidence({ endpoint: ENDPOINT });

      act(page);

      assert.equal(network.beacons.length, 1);
      assert.equal(network.fetches.length, 0);
    });
  }

  it('each decision is reported and sent on its own, in order', (t) => {
    const network = installNetwork(t);
    const { reported, onDecision } = decisionRecorder();
    const { consent } = openEvidence({ endpoint: ENDPOINT, onDecision });

    consent.decide({ analytics: 'granted' });
    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(
      reported.map(({ changed }) => changed),
      [['analytics'], ['ads']],
    );
    assert.equal(network.beacons.length, 2);
  });

  it('a decision that changes nothing is not notified, so nothing is reported', (t) => {
    const network = installNetwork(t);
    const { reported, onDecision } = decisionRecorder();
    const { consent } = openEvidence({ endpoint: ENDPOINT, onDecision });
    consent.decide({ ads: 'denied' });

    consent.decide({ ads: 'denied' });

    assert.equal(reported.length, 1);
    assert.equal(network.beacons.length, 1);
  });

  it('onDecision is called before the send', (t) => {
    const order: string[] = [];
    const { beacons } = installNetwork(t);
    const { consent } = openEvidence({
      endpoint: ENDPOINT,
      onDecision: () => {
        order.push(`onDecision with ${String(beacons.length)} sends`);
      },
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(order, ['onDecision with 0 sends']);
    assert.equal(beacons.length, 1);
  });

  it('an exception of onDecision is rethrown in a microtask, and the decision is still sent', (t) => {
    const scheduled = captureMicrotasks(t);
    const network = installNetwork(t);
    const failure = new Error('onDecision failed');
    const { consent } = openEvidence({
      endpoint: ENDPOINT,
      onDecision: () => {
        throw failure;
      },
    });

    assert.doesNotThrow(() => {
      consent.decide({ ads: 'granted' });
    });

    assert.equal(network.beacons.length, 1);
    assert.equal(scheduled.length, 1);
    assert.throws(() => scheduled[0]?.(), failure);
  });

  it('a decision made inside onDecision is reported after the one being delivered', () => {
    const reported: (readonly PurposeId[])[] = [];
    const { consent } = openEvidence({
      onDecision: ({ changed, snapshot }) => {
        reported.push(changed);
        if (snapshot.status.ads === 'granted') consent.decide({ ads: 'denied' });
      },
    });

    consent.decide({ ads: 'granted', analytics: 'granted' });

    assert.deepStrictEqual(reported, [['analytics', 'ads'], ['ads']]);
    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });
});

describe('changes of source restore', () => {
  it('a restored record is neither reported nor sent', (t) => {
    const network = installNetwork(t);
    const { reported, onDecision } = decisionRecorder();
    const { consent, changes } = openEvidence({ endpoint: ENDPOINT, onDecision });

    consent.restore(serialized({ ads: decisionOf('granted') }));

    assert.equal(changes[0]?.source, 'restore');
    assert.deepStrictEqual(reported, []);
    assert.deepStrictEqual(network, { beacons: [], fetches: [] });
  });

  it('a revocation restored from another tab is neither reported nor sent', (t) => {
    const network = installNetwork(t);
    const { reported, onDecision } = decisionRecorder();
    const { consent } = openEvidence(
      { endpoint: ENDPOINT, onDecision },
      { record: serialized({ ads: decisionOf('granted') }) },
    );

    consent.restore(serialized({ ads: decisionOf('denied') }));

    assert.equal(consent.getSnapshot().status.ads, 'denied');
    assert.deepStrictEqual(reported, []);
    assert.deepStrictEqual(network, { beacons: [], fetches: [] });
  });
});

describe('hydration', () => {
  it('the record hydrated by the manager is neither reported nor sent on connection', (t) => {
    const network = installNetwork(t);
    const { reported, onDecision } = decisionRecorder();
    const tab = setup({ record: serialized({ ads: decisionOf('granted') }) });

    connectEvidenceTo(tab, { endpoint: ENDPOINT, onDecision });

    assert.deepStrictEqual(reported, []);
    assert.deepStrictEqual(network, { beacons: [], fetches: [] });
  });

  it('a decision made before the connection is not reported', () => {
    const { reported, onDecision } = decisionRecorder();
    const tab = setup();
    tab.consent.decide({ ads: 'granted' });

    connectEvidenceTo(tab, { onDecision });

    assert.deepStrictEqual(reported, []);
  });
});
