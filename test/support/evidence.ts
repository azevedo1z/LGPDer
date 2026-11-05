/**
 * Pages for the tests of the evidence layer: managers of the default fixture connected to the
 * layer, and doubles of the network (`navigator.sendBeacon` and `fetch`) that record every send.
 * Importing this module installs the DOM. Every layer connected here must be destroyed with
 * {@link closeEvidences} in `afterEach`, so that no subscription outlives its test.
 */
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

import type { ConsentEvidence, EvidenceOptions } from 'lgpder/evidence';

import { connectEvidence } from '../../src/evidence/index.ts';
import { testDom } from './dom.ts';
import { setup, type FixtureSetupOptions, type PurposeId, type Setup } from './setup.ts';

/** Endpoint of the tests, on the origin of the test page. */
export const ENDPOINT = 'https://www.example.com.br/api/consent';

/** Manager of the default fixture, its recorder and its evidence layer. */
export interface EvidencePage extends Setup<PurposeId> {
  readonly evidence: ConsentEvidence;
}

const opened: ConsentEvidence[] = [];

/**
 * Creates the manager of the default fixture, subscribes the recorder and then connects the
 * evidence layer with `options`.
 */
export function openEvidence(
  options: EvidenceOptions<PurposeId>,
  fixture?: FixtureSetupOptions,
): EvidencePage {
  return connectEvidenceTo(setup(fixture), options);
}

/** Connects the evidence layer, with `options`, to a manager already set up. */
export function connectEvidenceTo(
  tab: Setup<PurposeId>,
  options: EvidenceOptions<PurposeId>,
): EvidencePage {
  const evidence = connectEvidence(tab.consent, options);
  opened.push(evidence);
  return { ...tab, evidence };
}

/** Destroys the evidence layer of every page opened since the last call. */
export function closeEvidences(): void {
  for (const evidence of opened.splice(0)) evidence.destroy();
}

/**
 * What the beacon double does: returns `true` (the browser queued the body) or `false`, throws, or
 * is missing from `navigator`, as in jsdom.
 */
export type BeaconBehavior = boolean | 'throws' | 'missing';

/** What the fetch double does: resolves with a response of this status, rejects or throws. */
export type FetchBehavior = number | 'rejects' | 'throws';

export interface NetworkBehavior {
  /** Default: `true`. */
  readonly beacon?: BeaconBehavior;
  /** Default: `200`. */
  readonly fetch?: FetchBehavior;
}

/** A call to `navigator.sendBeacon`. */
export interface BeaconCall {
  readonly url: string;
  readonly data: unknown;
}

/** A call to `fetch`. */
export interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/** Calls recorded by the network doubles, in order. */
export interface Network {
  readonly beacons: BeaconCall[];
  readonly fetches: FetchCall[];
}

/** Error of the beacon double that throws. */
export const BEACON_ERROR = new TypeError('Beacon refused by the test.');

/** Error of the fetch double that rejects or throws, as a network failure. */
export const FETCH_ERROR = new TypeError('Failed to fetch.');

/**
 * Replaces `navigator.sendBeacon` and `fetch` with doubles that behave as `behavior` says and
 * record every call. Both are restored when the test ends; nothing reaches the network.
 */
export function installNetwork(
  t: TestContext,
  { beacon = true, fetch = 200 }: NetworkBehavior = {},
): Network {
  const network: Network = { beacons: [], fetches: [] };
  const { navigator } = testDom.window;
  if (beacon !== 'missing') {
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (url: string, data: unknown): boolean => {
        network.beacons.push({ url, data });
        if (beacon === 'throws') throw BEACON_ERROR;
        return beacon;
      },
    });
    t.after(() => {
      Reflect.deleteProperty(navigator, 'sendBeacon');
    });
  }
  t.mock.method(globalThis, 'fetch', (url: string, init?: RequestInit): Promise<Response> => {
    network.fetches.push({ url, init });
    if (fetch === 'throws') throw FETCH_ERROR;
    if (fetch === 'rejects') return Promise.reject(FETCH_ERROR);
    return Promise.resolve(new Response(null, { status: fetch }));
  });
  return network;
}

/** A body sent by the layer, which is always a `Blob`, parsed as JSON. */
export async function payloadOf(body: unknown): Promise<unknown> {
  assert.ok(body instanceof Blob, 'the body is a Blob');
  return JSON.parse(await body.text()) as unknown;
}

/** Every body sent by the beacon, parsed as JSON, in order. */
export async function beaconPayloads({ beacons }: Network): Promise<unknown[]> {
  return Promise.all(beacons.map(({ data }) => payloadOf(data)));
}

/** Waits until the promises of the sends settle and the layer has handled their results. */
export async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Records the errors passed to `onError`, in order. */
export function errorRecorder(): {
  readonly errors: unknown[];
  readonly onError: (error: unknown) => void;
} {
  const errors: unknown[] = [];
  return {
    errors,
    onError: (error) => {
      errors.push(error);
    },
  };
}
