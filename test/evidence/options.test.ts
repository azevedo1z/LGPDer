/**
 * Validation of the options: unknown keys, invalid values, the endpoint (HTTPS, or HTTP on
 * localhost), order, own properties only, and no effect before the validation ends.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, type TestContext } from 'node:test';

import type { ConsentEvidence } from 'lgpder/evidence';

import { connectEvidence } from '../../src/evidence/index.ts';
import { testDom } from '../support/dom.ts';
import {
  ENDPOINT,
  closeEvidences,
  connectEvidenceTo,
  errorRecorder,
  installNetwork,
  openEvidence,
  settle,
  type EvidencePage,
} from '../support/evidence.ts';
import { callUntyped, setup, withObjectPollution, withPrototype } from '../support/setup.ts';

afterEach(() => {
  closeEvidences();
  testDom.reset();
});

/** `connectEvidence` called from JavaScript, with any value (or none) as options, then destroyed. */
function connectUntyped(...options: unknown[]): void {
  const { consent } = setup();
  callUntyped<ConsentEvidence>(connectEvidence, consent, ...options).destroy();
}

/** Connects the layer with `endpoint` and returns the address the beacon received. */
function sentTo(t: TestContext, endpoint: string): string {
  const network = installNetwork(t);
  openEvidence({ endpoint }).consent.decide({ ads: 'granted' });
  return network.beacons[0]?.url ?? '';
}

const OPTIONS_OBJECT = '[lgpder] Options must be an object.';
const ENDPOINT_STRING = '[lgpder] "endpoint" must be a non-empty string.';
const ENDPOINT_SECURE = '[lgpder] "endpoint" must be an HTTPS URL, or HTTP on localhost.';
const REQUIRED = '[lgpder] "endpoint" or "onDecision" is required.';

interface InvalidOptions {
  readonly case: string;
  readonly options: unknown;
  readonly message: string;
}

const INVALID_OPTIONS: readonly InvalidOptions[] = [
  { case: 'no options', options: undefined, message: OPTIONS_OBJECT },
  { case: 'null options', options: null, message: OPTIONS_OBJECT },
  { case: 'string options', options: ENDPOINT, message: OPTIONS_OBJECT },
  {
    case: 'an unknown option',
    options: { endpoint: ENDPOINT, onRevoke: () => undefined },
    message: '[lgpder] Unknown option: "onRevoke".',
  },
  { case: 'empty options', options: {}, message: REQUIRED },
  { case: 'only onError', options: { onError: () => undefined }, message: REQUIRED },
  {
    case: 'endpoint and onDecision undefined',
    options: { endpoint: undefined, onDecision: undefined },
    message: REQUIRED,
  },
  { case: 'an endpoint that is a number', options: { endpoint: 443 }, message: ENDPOINT_STRING },
  {
    case: 'an endpoint that is a URL object',
    options: { endpoint: new URL(ENDPOINT) },
    message: ENDPOINT_STRING,
  },
  { case: 'an empty endpoint', options: { endpoint: '' }, message: ENDPOINT_STRING },
  { case: 'a blank endpoint', options: { endpoint: ' \t ' }, message: ENDPOINT_STRING },
  {
    case: 'onDecision that is not a function',
    options: { onDecision: 'log' },
    message: '[lgpder] "onDecision" must be a function.',
  },
  {
    case: 'onError that is not a function',
    options: { endpoint: ENDPOINT, onError: true },
    message: '[lgpder] "onError" must be a function.',
  },
  // Order of the checks: keys, endpoint, onDecision, onError, then endpoint or onDecision.
  {
    case: 'every option invalid',
    options: { endpoint: 'http://www.example.com.br/', onDecision: 1, onError: 1 },
    message: ENDPOINT_SECURE,
  },
  {
    case: 'onDecision and onError invalid',
    options: { onDecision: 1, onError: 1 },
    message: '[lgpder] "onDecision" must be a function.',
  },
  {
    case: 'onError invalid and no endpoint nor onDecision',
    options: { onError: 1 },
    message: '[lgpder] "onError" must be a function.',
  },
];

describe('invalid options', () => {
  for (const { case: label, options, message } of INVALID_OPTIONS) {
    it(`${label}: TypeError`, () => {
      assert.throws(
        () => {
          connectUntyped(options);
        },
        { name: 'TypeError', message },
      );
    });
  }
});

describe('endpoint (D50)', () => {
  const REFUSED = [
    { case: 'HTTP on another host', endpoint: 'http://www.example.com.br/api/consent' },
    { case: 'HTTP on a host that starts with localhost', endpoint: 'http://localhost.evil.test/' },
    { case: 'HTTP on another loopback address', endpoint: 'http://127.0.0.2/' },
    { case: 'a WebSocket URL on localhost', endpoint: 'ws://localhost/' },
    { case: 'an FTP URL', endpoint: 'ftp://www.example.com.br/consent' },
    { case: 'a javascript: URL', endpoint: 'javascript:alert(1)' },
    { case: 'a data: URL', endpoint: 'data:application/json,{}' },
    { case: 'an HTTPS URL without host', endpoint: 'https://' },
    { case: 'an invalid URL', endpoint: 'https://[' },
  ];

  for (const { case: label, endpoint } of REFUSED) {
    it(`refuses ${label}`, () => {
      assert.throws(
        () => {
          connectUntyped({ endpoint });
        },
        { name: 'TypeError', message: ENDPOINT_SECURE },
      );
    });
  }

  const ACCEPTED = [
    { case: 'HTTPS on the page host', endpoint: ENDPOINT, sent: ENDPOINT },
    {
      case: 'HTTPS on another host, which the controller is responsible for',
      endpoint: 'https://consent.example.org/evidence',
      sent: 'https://consent.example.org/evidence',
    },
    {
      case: 'HTTP on localhost',
      endpoint: 'http://localhost:3000/x',
      sent: 'http://localhost:3000/x',
    },
    { case: 'HTTP on 127.0.0.1', endpoint: 'http://127.0.0.1/x', sent: 'http://127.0.0.1/x' },
    { case: 'HTTP on [::1]', endpoint: 'http://[::1]:8080/x', sent: 'http://[::1]:8080/x' },
    {
      case: 'HTTP on LOCALHOST, normalized',
      endpoint: 'HTTP://LOCALHOST/x',
      sent: 'http://localhost/x',
    },
    { case: 'a path, resolved against the page', endpoint: '/api/consent', sent: ENDPOINT },
    {
      case: 'a relative path, resolved against the page',
      endpoint: 'api/consent',
      sent: ENDPOINT,
    },
    {
      case: 'a protocol-relative URL, on an HTTPS page',
      endpoint: '//www.example.com.br/api/consent',
      sent: ENDPOINT,
    },
    { case: 'an endpoint with spaces around it', endpoint: ` ${ENDPOINT} `, sent: ENDPOINT },
  ];

  for (const { case: label, endpoint, sent } of ACCEPTED) {
    it(`accepts ${label}`, (t) => {
      assert.equal(sentTo(t, endpoint), sent);
    });
  }

  it('a relative endpoint on an HTTP page outside localhost is refused', () => {
    testDom.navigate('http://www.example.com.br/');

    assert.throws(
      () => {
        connectUntyped({ endpoint: '/api/consent' });
      },
      { name: 'TypeError', message: ENDPOINT_SECURE },
    );
  });

  it('a relative endpoint on an HTTP page on localhost is accepted', (t) => {
    testDom.navigate('http://localhost:5173/app/');

    assert.equal(sentTo(t, '/api/consent'), 'http://localhost:5173/api/consent');
  });

  it('is resolved when the layer connects, not when a decision is sent', (t) => {
    const network = installNetwork(t);
    const { consent } = openEvidence({ endpoint: 'api/consent' });

    testDom.navigate('https://www.example.com.br/other/page');
    consent.decide({ ads: 'granted' });

    assert.equal(network.beacons[0]?.url, ENDPOINT);
  });
});

describe('valid options', () => {
  it('accepts onDecision alone, endpoint alone and every option', () => {
    for (const options of [
      { onDecision: () => undefined },
      { endpoint: ENDPOINT },
      { endpoint: ENDPOINT, onDecision: () => undefined, onError: () => undefined },
      { endpoint: undefined, onDecision: () => undefined, onError: undefined },
    ]) {
      assert.doesNotThrow(() => {
        connectUntyped(options);
      });
    }
  });

  it('reads the values of null-prototype options', (t) => {
    const network = installNetwork(t);
    const options = withPrototype({ endpoint: ENDPOINT }, null);
    const { consent } = callUntyped<EvidencePage>(connectEvidenceTo, setup(), options);

    consent.decide({ ads: 'granted' });

    assert.equal(network.beacons.length, 1);
  });
});

describe('validation before any effect', () => {
  it('invalid options never subscribe to the manager', (t) => {
    const { consent } = setup();
    // The functions of the manager do not depend on this, so a copy works as the manager.
    const subscribe = t.mock.fn(consent.subscribe);

    assert.throws(() =>
      callUntyped(connectEvidence, { ...consent, subscribe }, { endpoint: ENDPOINT, onError: 1 }),
    );

    assert.equal(subscribe.mock.callCount(), 0);
  });
});

describe('inherited options are never read', () => {
  /**
   * Connects the layer with `options` and decides to grant ads, with `pollution` planted on
   * `Object.prototype` meanwhile.
   */
  function decidePolluted(
    pollution: Readonly<Record<string, unknown>>,
    options: object,
  ): EvidencePage {
    const tab = setup();
    return withObjectPollution(pollution, () => {
      const page = callUntyped<EvidencePage>(connectEvidenceTo, tab, options);
      page.consent.decide({ ads: 'granted' });
      return page;
    });
  }

  it('an inherited endpoint is ignored: nothing is sent', (t) => {
    const network = installNetwork(t, { beacon: false });

    decidePolluted({ endpoint: 'https://collector.evil.test/' }, { onDecision: () => undefined });

    assert.deepStrictEqual(network, { beacons: [], fetches: [] });
  });

  it('an inherited endpoint does not satisfy the required endpoint or onDecision', () => {
    assert.throws(() => decidePolluted({ endpoint: ENDPOINT }, {}), {
      name: 'TypeError',
      message: REQUIRED,
    });
  });

  it('an inherited onDecision is never called', (t) => {
    const network = installNetwork(t);
    let called = false;

    decidePolluted(
      {
        onDecision: () => {
          called = true;
        },
      },
      { endpoint: ENDPOINT },
    );

    assert.equal(called, false);
    assert.equal(network.beacons.length, 1);
  });

  it('an inherited onError is never called', async (t) => {
    installNetwork(t, { beacon: false, fetch: 'rejects' });
    const inherited = errorRecorder();

    decidePolluted({ onError: inherited.onError }, { endpoint: ENDPOINT });
    await settle();

    assert.deepStrictEqual(inherited.errors, []);
  });
});
