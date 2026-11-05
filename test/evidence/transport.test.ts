/**
 * How the evidence reaches the endpoint: navigator.sendBeacon first and, when the beacon is
 * missing, refuses or throws, fetch with keepalive. Failures go to onError, never to the consent,
 * and nothing is sent again.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { captureMicrotasks } from '../support/capture.ts';
import { testDom } from '../support/dom.ts';
import {
  ENDPOINT,
  FETCH_ERROR,
  closeEvidences,
  errorRecorder,
  installNetwork,
  openEvidence,
  settle,
  type BeaconBehavior,
} from '../support/evidence.ts';

afterEach(() => {
  closeEvidences();
  testDom.reset();
});

describe('beacon', () => {
  it('a queued beacon sends the evidence to the endpoint, without fetch', (t) => {
    const network = installNetwork(t, { beacon: true });
    const { consent } = openEvidence({ endpoint: ENDPOINT });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(
      network.beacons.map(({ url }) => url),
      [ENDPOINT],
    );
    assert.deepStrictEqual(network.fetches, []);
  });

  const FALLBACKS: readonly { readonly case: string; readonly beacon: BeaconBehavior }[] = [
    { case: 'returns false', beacon: false },
    { case: 'throws', beacon: 'throws' },
    { case: 'is missing', beacon: 'missing' },
  ];

  for (const { case: label, beacon } of FALLBACKS) {
    it(`a beacon that ${label} falls back to fetch with keepalive`, (t) => {
      const network = installNetwork(t, { beacon });
      const { consent } = openEvidence({ endpoint: ENDPOINT });

      consent.decide({ ads: 'granted' });

      assert.equal(network.fetches.length, 1);
      const [{ url, init } = { url: '', init: undefined }] = network.fetches;
      assert.equal(url, ENDPOINT);
      assert.ok(init?.body instanceof Blob);
      assert.deepStrictEqual(init, {
        method: 'POST',
        body: init.body,
        keepalive: true,
        credentials: 'same-origin',
        redirect: 'error',
      });
    });
  }

  it('a beacon that throws is not reported to onError, because fetch is tried', async (t) => {
    installNetwork(t, { beacon: 'throws' });
    const { errors, onError } = errorRecorder();
    const { consent } = openEvidence({ endpoint: ENDPOINT, onError });

    consent.decide({ ads: 'granted' });
    await settle();

    assert.deepStrictEqual(errors, []);
  });
});

describe('fetch', () => {
  for (const status of [200, 201, 204]) {
    it(`a response with status ${String(status)} is a success`, async (t) => {
      installNetwork(t, { beacon: false, fetch: status });
      const { errors, onError } = errorRecorder();
      const { consent } = openEvidence({ endpoint: ENDPOINT, onError });

      consent.decide({ ads: 'granted' });
      await settle();

      assert.deepStrictEqual(errors, []);
    });
  }

  it('refuses redirects, so a redirected POST never becomes a GET without the evidence', (t) => {
    const network = installNetwork(t, { beacon: false });
    const { consent } = openEvidence({ endpoint: ENDPOINT });

    consent.decide({ ads: 'granted' });

    assert.equal(network.fetches[0]?.init?.redirect, 'error');
  });

  for (const status of [400, 404, 500, 503]) {
    it(`a response with status ${String(status)} is reported to onError`, async (t) => {
      installNetwork(t, { beacon: false, fetch: status });
      const { errors, onError } = errorRecorder();
      const { consent } = openEvidence({ endpoint: ENDPOINT, onError });

      consent.decide({ ads: 'granted' });
      await settle();

      assert.equal(errors.length, 1);
      assert.ok(errors[0] instanceof Error);
      assert.equal(
        errors[0].message,
        `[lgpder] Evidence endpoint responded with status ${String(status)}.`,
      );
    });
  }

  it('a rejection is reported to onError with its own error', async (t) => {
    installNetwork(t, { beacon: false, fetch: 'rejects' });
    const { errors, onError } = errorRecorder();
    const { consent } = openEvidence({ endpoint: ENDPOINT, onError });

    consent.decide({ ads: 'granted' });
    await settle();

    assert.deepStrictEqual(errors, [FETCH_ERROR]);
  });

  it('a synchronous exception of fetch is reported to onError, and decide does not throw', async (t) => {
    installNetwork(t, { beacon: false, fetch: 'throws' });
    const { errors, onError } = errorRecorder();
    const { consent } = openEvidence({ endpoint: ENDPOINT, onError });

    assert.doesNotThrow(() => {
      consent.decide({ ads: 'granted' });
    });
    await settle();

    assert.deepStrictEqual(errors, [FETCH_ERROR]);
  });
});

describe('failures', () => {
  it('do not affect the consent', async (t) => {
    installNetwork(t, { beacon: false, fetch: 'rejects' });
    const { consent, changes } = openEvidence({ endpoint: ENDPOINT });

    consent.decide({ ads: 'granted' });
    await settle();

    assert.equal(consent.getSnapshot().status.ads, 'granted');
    assert.equal(changes.length, 1);
  });

  it('are never sent again', async (t) => {
    const network = installNetwork(t, { beacon: false, fetch: 500 });
    const { errors, onError } = errorRecorder();
    const { consent } = openEvidence({ endpoint: ENDPOINT, onError });

    consent.decide({ ads: 'granted' });
    await settle();
    await settle();

    assert.equal(errors.length, 1);
    assert.equal(network.beacons.length, 1);
    assert.equal(network.fetches.length, 1);
  });

  it('do not stop the next decision from being sent', async (t) => {
    const network = installNetwork(t, { beacon: false, fetch: 'rejects' });
    const { consent } = openEvidence({ endpoint: ENDPOINT });

    consent.decide({ ads: 'granted' });
    await settle();
    consent.decide({ ads: 'denied' });

    assert.equal(network.fetches.length, 2);
  });

  it('are silent without onError: nothing is thrown or rethrown', async (t) => {
    const scheduled = captureMicrotasks(t);
    installNetwork(t, { beacon: false, fetch: 'rejects' });
    const { consent } = openEvidence({ endpoint: ENDPOINT });

    assert.doesNotThrow(() => {
      consent.decide({ ads: 'granted' });
    });
    await settle();

    assert.deepStrictEqual(scheduled, []);
  });

  it('an exception of onError is rethrown in a microtask', async (t) => {
    const scheduled = captureMicrotasks(t);
    installNetwork(t, { beacon: false, fetch: 'rejects' });
    const failure = new Error('onError failed');
    const { consent } = openEvidence({
      endpoint: ENDPOINT,
      onError: () => {
        throw failure;
      },
    });

    consent.decide({ ads: 'granted' });
    await settle();

    assert.equal(scheduled.length, 1);
    assert.throws(() => scheduled[0]?.(), failure);
  });
});
