/** onGranted: when the code of the application runs, its cleanup and its cancellation. */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { RevokeEvent } from 'lgpder/scripts';

import { captureMicrotasks } from '../support/capture.ts';
import { testDom } from '../support/dom.ts';
import { closePages, openPage } from '../support/page.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { callUntyped, type PurposeId } from '../support/setup.ts';

afterEach(() => {
  closePages();
  testDom.reset();
});

/** Function for onGranted that logs each run and each cleanup in `log`. */
function withCleanup(log: string[], name = 'fn'): () => () => void {
  return () => {
    log.push(`${name} ran`);
    return () => {
      log.push(`${name} cleaned`);
    };
  };
}

/** Function for onGranted that logs each run in `log` and returns no cleanup. */
function withoutCleanup(log: string[]): () => void {
  return () => {
    log.push('fn ran');
  };
}

describe('when fn runs', () => {
  it('right away when the purpose is already granted', () => {
    const { scripts } = openPage(undefined, { record: serialized({ ads: decisionOf('granted') }) });
    const log: string[] = [];

    scripts.onGranted('ads', withoutCleanup(log));

    assert.deepStrictEqual(log, ['fn ran']);
  });

  it('not while the purpose is pending or denied', () => {
    const { consent, scripts } = openPage();
    const log: string[] = [];

    scripts.onGranted('ads', withoutCleanup(log));
    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(log, []);
  });

  it('when the purpose becomes granted, once per grant', () => {
    const { consent, scripts } = openPage();
    const log: string[] = [];
    scripts.onGranted('ads', withoutCleanup(log));

    consent.decide({ ads: 'granted' });
    consent.decide({ analytics: 'granted' });

    assert.deepStrictEqual(log, ['fn ran']);
  });

  it('only for its own purpose', () => {
    const { consent, scripts } = openPage();
    const log: string[] = [];
    scripts.onGranted('analytics', withoutCleanup(log));

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(log, []);
  });
});

describe('a fn that returns a cleanup', () => {
  it('the cleanup runs when the purpose stops being granted', () => {
    const { consent, scripts } = openPage({ revocation: 'manual' });
    const log: string[] = [];
    scripts.onGranted('ads', withCleanup(log));
    consent.decide({ ads: 'granted' });

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(log, ['fn ran', 'fn cleaned']);
  });

  it('fn runs again on a new grant', () => {
    const { consent, scripts } = openPage({ revocation: 'manual' });
    const log: string[] = [];
    scripts.onGranted('ads', withCleanup(log));
    consent.decide({ ads: 'granted' });
    consent.decide({ ads: 'denied' });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(log, ['fn ran', 'fn cleaned', 'fn ran']);
  });

  it('leaves nothing running: the revocation does not require a reload', () => {
    const events: RevokeEvent<PurposeId>[] = [];
    const { consent, scripts } = openPage({ onRevoke: (event) => events.push(event) });
    scripts.onGranted('ads', withCleanup([]));
    consent.decide({ ads: 'granted' });

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(events, [{ purposes: ['ads'], requiresReload: false }]);
    assert.equal(testDom.reloads(), 0);
  });
});

describe('a fn without cleanup', () => {
  it('never runs again on this page', () => {
    const { consent, scripts } = openPage({ revocation: 'manual' });
    const log: string[] = [];
    scripts.onGranted('ads', withoutCleanup(log));
    consent.decide({ ads: 'granted' });
    consent.decide({ ads: 'denied' });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(log, ['fn ran']);
  });

  it('leaves code running: the revocation requires a reload', () => {
    const events: RevokeEvent<PurposeId>[] = [];
    const { consent, scripts } = openPage({
      revocation: 'manual',
      onRevoke: (event) => events.push(event),
    });
    scripts.onGranted('ads', withoutCleanup([]));
    consent.decide({ ads: 'granted' });

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(events, [{ purposes: ['ads'], requiresReload: true }]);
  });

  it('that throws counts as one without cleanup, and the error is rethrown in a microtask', (t) => {
    const scheduled = captureMicrotasks(t);
    const failure = new Error('faulty fn');
    const { scripts } = openPage(
      { revocation: 'manual' },
      {
        record: serialized({ ads: decisionOf('granted') }),
      },
    );

    scripts.onGranted('ads', () => {
      throw failure;
    });

    assert.equal(scripts.wouldReload({ ads: 'denied' }), false); // manual mode
    const [rethrow] = scheduled;
    assert.ok(rethrow);
    assert.throws(rethrow, (error) => error === failure);
  });

  it('that throws makes the revocation require a reload', (t) => {
    captureMicrotasks(t);
    const { scripts } = openPage(undefined, { record: serialized({ ads: decisionOf('granted') }) });

    scripts.onGranted('ads', () => {
      throw new Error('faulty fn');
    });

    assert.equal(scripts.wouldReload({ ads: 'denied' }), true);
  });
});

describe('the cancellation', () => {
  it('calls the pending cleanup, once', () => {
    const { scripts } = openPage(undefined, { record: serialized({ ads: decisionOf('granted') }) });
    const log: string[] = [];
    const cancel = scripts.onGranted('ads', withCleanup(log));

    cancel();
    cancel();

    assert.deepStrictEqual(log, ['fn ran', 'fn cleaned']);
  });

  it('stops later runs', () => {
    const { consent, scripts } = openPage();
    const log: string[] = [];
    const cancel = scripts.onGranted('ads', withCleanup(log));

    cancel();
    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(log, []);
  });

  it('made by fn itself calls the cleanup it returns', () => {
    const { consent, scripts } = openPage();
    const log: string[] = [];
    const cancel = scripts.onGranted('ads', () => {
      log.push('fn ran');
      cancel();
      return () => {
        log.push('fn cleaned');
      };
    });

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(log, ['fn ran', 'fn cleaned']);
  });
});

describe('errors', () => {
  it('a cleanup that throws is rethrown in a microtask, and the other cleanups still run', (t) => {
    const scheduled = captureMicrotasks(t);
    const { consent, scripts } = openPage({ revocation: 'manual' });
    const log: string[] = [];
    const failure = new Error('faulty cleanup');
    scripts.onGranted('ads', () => () => {
      throw failure;
    });
    scripts.onGranted('ads', withCleanup(log));
    consent.decide({ ads: 'granted' });

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(log, ['fn ran', 'fn cleaned']);
    const [rethrow] = scheduled;
    assert.ok(rethrow);
    assert.throws(rethrow, (error) => error === failure);
  });

  it('a purpose that is not configured is a RangeError', () => {
    const { scripts } = openPage();

    for (const purpose of ['unknown', 'toString', 1]) {
      assert.throws(() => callUntyped(scripts.onGranted, purpose, () => undefined), {
        name: 'RangeError',
        message: `[lgpder] Unknown purpose: ${JSON.stringify(String(purpose))}.`,
      });
    }
  });

  it('a fn that is not a function is a TypeError', () => {
    const { scripts } = openPage();

    assert.throws(() => callUntyped(scripts.onGranted, 'ads', 'fn'), {
      name: 'TypeError',
      message: '[lgpder] "fn" must be a function.',
    });
  });
});

describe('destroy', () => {
  it('calls the pending cleanups and cancels the registrations', () => {
    const { consent, scripts } = openPage(undefined, {
      record: serialized({ ads: decisionOf('granted') }),
    });
    const log: string[] = [];
    const cancel = scripts.onGranted('ads', withCleanup(log));

    scripts.destroy();
    cancel();
    consent.decide({ ads: 'denied' });
    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(log, ['fn ran', 'fn cleaned']);
  });

  it('makes onGranted throw', () => {
    const { scripts } = openPage();
    scripts.destroy();

    assert.throws(() => scripts.onGranted('ads', () => undefined), {
      name: 'Error',
      message: '[lgpder] This instance was destroyed.',
    });
  });
});

describe('several functions', () => {
  it('run in registration order', () => {
    const { consent, scripts } = openPage();
    const log: string[] = [];
    scripts.onGranted('ads', withCleanup(log, 'first'));
    scripts.onGranted('ads', withCleanup(log, 'second'));

    consent.decide({ ads: 'granted' });

    assert.deepStrictEqual(log, ['first ran', 'second ran']);
  });
});
