/** The handle: frozen, destroy idempotent and without this, and sends already started go on. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { testDom } from '../support/dom.ts';
import {
  ENDPOINT,
  FETCH_ERROR,
  closeEvidences,
  errorRecorder,
  installNetwork,
  openEvidence,
  settle,
} from '../support/evidence.ts';

afterEach(() => {
  closeEvidences();
  testDom.reset();
});

describe('handle', () => {
  it('is frozen, with destroy only', () => {
    const { evidence } = openEvidence({ onDecision: () => undefined });

    assert.ok(Object.isFrozen(evidence));
    assert.deepStrictEqual(Object.keys(evidence), ['destroy']);
  });
});

describe('destroy', () => {
  it('stops reporting and sending the next decisions', (t) => {
    const network = installNetwork(t);
    let reported = 0;
    const { consent, evidence } = openEvidence({
      endpoint: ENDPOINT,
      onDecision: () => {
        reported += 1;
      },
    });

    evidence.destroy();
    consent.decide({ ads: 'granted' });

    assert.equal(reported, 0);
    assert.deepStrictEqual(network, { beacons: [], fetches: [] });
  });

  it('called from onDecision, stops the send of the decision being reported', (t) => {
    const network = installNetwork(t);
    const page = openEvidence({
      endpoint: ENDPOINT,
      onDecision: () => {
        page.evidence.destroy();
      },
    });

    page.consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(network, { beacons: [], fetches: [] });
  });

  it('is idempotent and does not depend on this', () => {
    const { evidence } = openEvidence({ onDecision: () => undefined });
    const { destroy } = evidence;

    assert.doesNotThrow(() => {
      destroy();
      destroy();
    });
  });

  it('leaves the manager usable', () => {
    const { consent, evidence, changes } = openEvidence({ onDecision: () => undefined });

    evidence.destroy();
    consent.decide({ ads: 'granted' });

    assert.equal(consent.getSnapshot().status.ads, 'granted');
    assert.equal(changes.length, 1);
  });

  it('a send already started goes on, and its failure still reaches onError', async (t) => {
    const network = installNetwork(t, { beacon: false, fetch: 'rejects' });
    const { errors, onError } = errorRecorder();
    const { consent, evidence } = openEvidence({ endpoint: ENDPOINT, onError });

    consent.decide({ ads: 'granted' });
    evidence.destroy();
    await settle();

    assert.equal(network.fetches.length, 1);
    assert.deepStrictEqual(errors, [FETCH_ERROR]);
  });
});
