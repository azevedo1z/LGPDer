/**
 * Server environment: this file does not install the DOM, so `document` does not exist, as in
 * Node. The layer validates its options and returns a handle that does nothing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { connectScripts } from '../../src/scripts/index.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { callUntyped, setup } from '../support/setup.ts';

const ADS_GRANTED = serialized({ ads: decisionOf('granted') });

describe('connectScripts without document', () => {
  it('runs without document', () => {
    assert.equal(typeof document, 'undefined');
  });

  it('connects, scans and decides without throwing', () => {
    const { consent } = setup({ record: ADS_GRANTED });
    const scripts = connectScripts(consent, {
      purposes: { ads: { integrations: ['google-ads'] } },
      debug: true,
    });

    assert.doesNotThrow(() => {
      scripts.scan();
      consent.decide({ ads: 'denied' });
      consent.decide({ ads: 'granted' });
      scripts.destroy();
    });
  });

  it('never runs a fn of onGranted, and its cancellation does nothing', () => {
    const { consent } = setup({ record: ADS_GRANTED });
    const scripts = connectScripts(consent);
    const log: string[] = [];

    const cancel = scripts.onGranted('ads', () => {
      log.push('fn ran');
      return () => log.push('fn cleaned');
    });
    consent.decide({ ads: 'denied' });
    consent.decide({ ads: 'granted' });
    cancel();
    scripts.destroy();

    assert.deepStrictEqual(log, []);
  });

  it('never subscribes to the manager, so a revocation reports nothing', () => {
    const { consent } = setup({ record: ADS_GRANTED });
    const events: unknown[] = [];
    const scripts = connectScripts(consent, { onRevoke: (event) => events.push(event) });

    consent.decide({ ads: 'denied' });
    scripts.destroy();

    assert.deepStrictEqual(events, []);
  });

  it('wouldReload is false', () => {
    const { consent } = setup({ record: ADS_GRANTED });
    const scripts = connectScripts(consent);

    assert.equal(scripts.wouldReload({ ads: 'denied' }), false);
    scripts.destroy();
  });

  it('the options and the arguments are still validated', () => {
    const { consent } = setup();
    const scripts = connectScripts(consent);

    assert.throws(() => callUntyped(connectScripts, consent, { revocation: 'never' }), TypeError);
    assert.throws(() => callUntyped(scripts.onGranted, 'typo', () => undefined), RangeError);
    assert.throws(() => callUntyped(scripts.wouldReload, { typo: 'denied' }), RangeError);
    assert.throws(() => {
      callUntyped(scripts.scan, 'body');
    }, TypeError);
    scripts.destroy();
  });

  it('a destroyed handle throws as in the browser', () => {
    const { consent } = setup();
    const scripts = connectScripts(consent);
    scripts.destroy();

    assert.throws(
      () => {
        scripts.scan();
      },
      { message: '[lgpder] This instance was destroyed.' },
    );
  });
});
