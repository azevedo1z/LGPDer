/**
 * Server environment: this file does not install the DOM, so `document`, `window` and `location`
 * do not exist, as in Node. The layer validates its options and returns a handle that does nothing:
 * nothing is reported, nothing is sent.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { connectEvidence } from '../../src/evidence/index.ts';
import { callUntyped, setup } from '../support/setup.ts';

const ENDPOINT = 'https://www.example.com.br/api/consent';

describe('connectEvidence without document', () => {
  it('runs without document, window and location', () => {
    assert.equal(typeof document, 'undefined');
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof location, 'undefined');
  });

  it('connects, follows decisions and destroys without reporting or sending anything', (t) => {
    const fetch = t.mock.method(globalThis, 'fetch');
    const { consent } = setup();
    let reported = 0;

    assert.doesNotThrow(() => {
      const evidence = connectEvidence(consent, {
        endpoint: ENDPOINT,
        onDecision: () => {
          reported += 1;
        },
      });
      consent.decide({ ads: 'granted' });
      evidence.destroy();
      evidence.destroy();
    });
    assert.equal(reported, 0);
    assert.equal(fetch.mock.callCount(), 0);
  });

  it('never subscribes to the manager', (t) => {
    const { consent } = setup();
    // The functions of the manager do not depend on this, so a copy works as the manager.
    const subscribe = t.mock.fn(consent.subscribe);

    connectEvidence({ ...consent, subscribe }, { endpoint: ENDPOINT }).destroy();

    assert.equal(subscribe.mock.callCount(), 0);
  });

  it('the options are still validated', () => {
    const { consent } = setup();

    assert.throws(() => callUntyped(connectEvidence, consent, {}), {
      name: 'TypeError',
      message: '[lgpder] "endpoint" or "onDecision" is required.',
    });
    assert.throws(() => callUntyped(connectEvidence, consent, { onDecision: 1 }), {
      name: 'TypeError',
      message: '[lgpder] "onDecision" must be a function.',
    });
  });

  it('an absolute endpoint is checked without the page', () => {
    const { consent } = setup();

    assert.throws(
      () => callUntyped(connectEvidence, consent, { endpoint: 'http://www.example.com.br/' }),
      {
        name: 'TypeError',
        message: '[lgpder] "endpoint" must be an HTTPS URL, or HTTP on localhost.',
      },
    );
    assert.doesNotThrow(() => {
      connectEvidence(consent, { endpoint: 'http://localhost:3000/consent' }).destroy();
    });
  });

  it('a relative endpoint is accepted, because only the page can resolve it', () => {
    const { consent } = setup();

    assert.doesNotThrow(() => {
      connectEvidence(consent, { endpoint: '/api/consent' }).destroy();
    });
  });

  it('the handle is frozen', () => {
    const { consent } = setup();
    const evidence = connectEvidence(consent, { endpoint: ENDPOINT });

    assert.ok(Object.isFrozen(evidence));
    evidence.destroy();
  });
});
