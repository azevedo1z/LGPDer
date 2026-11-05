/**
 * Content of the evidence: the record after the decision, the changed purposes and the version of
 * every versioned purpose, as JSON. Nothing that identifies the data subject, the device or the
 * receipt is generated in the browser.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { connectEvidence } from '../../src/evidence/index.ts';
import { testDom } from '../support/dom.ts';
import {
  ENDPOINT,
  beaconPayloads,
  closeEvidences,
  installNetwork,
  openEvidence,
  payloadOf,
} from '../support/evidence.ts';
import { decisionOf, recordOf, serialized } from '../support/records.ts';
import { START, setup } from '../support/setup.ts';

afterEach(() => {
  closeEvidences();
  testDom.reset();
});

/** Versions of the default fixture: `analytics` and `health` are versioned, `ads` is not. */
const FIXTURE_VERSIONS = { analytics: '2026-10', health: '1' } as const;

describe('payload', () => {
  it('is the record after the decision, the changed purposes and the versions', async (t) => {
    const network = installNetwork(t);
    const { consent } = openEvidence({ endpoint: ENDPOINT });

    consent.decide({ ads: 'denied', analytics: 'granted' });

    assert.deepStrictEqual(await beaconPayloads(network), [
      {
        record: recordOf({
          analytics: decisionOf('granted', { version: '2026-10' }),
          ads: decisionOf('denied'),
        }),
        changed: ['analytics', 'ads'],
        versions: FIXTURE_VERSIONS,
      },
    ]);
  });

  it('is exactly the JSON of record, changed and versions, with no other field', async (t) => {
    const network = installNetwork(t);
    const { consent } = openEvidence({ endpoint: ENDPOINT });

    consent.decide({ ads: 'granted' });

    const text = await (network.beacons[0]?.data as Blob).text();
    assert.equal(
      text,
      JSON.stringify({
        record: { format: 1, decisions: { ads: { status: 'granted', decidedAt: START } } },
        changed: ['ads'],
        versions: FIXTURE_VERSIONS,
      }),
    );
  });

  it('the same decision on two pages sends the same bytes: nothing identifies the page', async (t) => {
    const network = installNetwork(t);
    const first = openEvidence({ endpoint: ENDPOINT });
    const second = openEvidence({ endpoint: ENDPOINT });

    first.consent.grantAll();
    second.consent.grantAll();

    const [one, other] = await Promise.all(
      network.beacons.map(async ({ data }) => (data as Blob).text()),
    );
    assert.equal(network.beacons.length, 2);
    assert.equal(one, other);
  });

  it('the record is the full one, with the decisions of the purposes that did not change', async (t) => {
    const network = installNetwork(t);
    const { consent } = openEvidence(
      { endpoint: ENDPOINT },
      { record: serialized({ ads: decisionOf('granted') }) },
    );

    consent.decide({ health: 'denied' });

    const [payload] = await beaconPayloads(network);
    assert.deepStrictEqual(payload, {
      record: recordOf({
        ads: decisionOf('granted'),
        health: decisionOf('denied', { version: '1' }),
      }),
      changed: ['health'],
      versions: FIXTURE_VERSIONS,
    });
  });

  it('a revocation is sent as the denied decision', async (t) => {
    const network = installNetwork(t);
    const { consent } = openEvidence(
      { endpoint: ENDPOINT },
      { record: serialized({ ads: decisionOf('granted') }) },
    );

    consent.denyAll();

    const [payload] = await beaconPayloads(network);
    assert.deepStrictEqual(payload, {
      record: recordOf({
        analytics: decisionOf('denied', { version: '2026-10' }),
        ads: decisionOf('denied'),
        health: decisionOf('denied', { version: '1' }),
      }),
      changed: ['analytics', 'ads', 'health'],
      versions: FIXTURE_VERSIONS,
    });
  });

  it('versions is empty when no purpose is versioned', async (t) => {
    const network = installNetwork(t);
    const { consent } = setup({ purposes: { ads: {}, video: {} } });
    const evidence = connectEvidence(consent, { endpoint: ENDPOINT });

    consent.decide({ video: 'granted' });
    evidence.destroy();

    const [payload] = await beaconPayloads(network);
    assert.deepStrictEqual(payload, {
      record: recordOf({ video: decisionOf('granted') }),
      changed: ['video'],
      versions: {},
    });
  });

  it('is a Blob of type application/json', (t) => {
    const network = installNetwork(t);
    const { consent } = openEvidence({ endpoint: ENDPOINT });

    consent.decide({ ads: 'granted' });

    const body = network.beacons[0]?.data;
    assert.ok(body instanceof Blob);
    assert.equal(body.type, 'application/json');
  });

  it('the fetch fallback sends the same body as the beacon', async (t) => {
    const network = installNetwork(t, { beacon: false });
    const { consent } = openEvidence({ endpoint: ENDPOINT });

    consent.decide({ ads: 'granted' });

    const [beacon] = network.beacons;
    const [fetched] = network.fetches;
    assert.equal(fetched?.init?.body, beacon?.data);
    assert.deepStrictEqual(await payloadOf(fetched?.init?.body), await payloadOf(beacon?.data));
  });
});
