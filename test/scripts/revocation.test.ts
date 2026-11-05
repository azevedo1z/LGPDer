/**
 * Revocation: what counts as one, onRevoke in both modes, the reload and wouldReload, decided from
 * the current state of the manager even when it changes during a notification.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { RevokeEvent, ScriptsOptions } from 'lgpder/scripts';

import { testDom } from '../support/dom.ts';
import {
  captureMicrotasks,
  closePages,
  connectPage,
  find,
  flushMicrotasks,
  openPage,
  render,
  type Page,
} from '../support/page.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { callUntyped, DAY, setup, type PurposeId } from '../support/setup.ts';

afterEach(() => {
  closePages();
  testDom.reset();
});

const SCRIPT = '<script type="text/plain" data-consent="analytics">track();</script>';
const IFRAME = '<iframe data-consent="ads" data-src="https://video.example/embed"></iframe>';
const BOTH_GRANTED = serialized({
  analytics: decisionOf('granted', { version: '2026-10' }),
  ads: decisionOf('granted'),
});

interface RevokedPage extends Page {
  readonly events: RevokeEvent<PurposeId>[];
}

/**
 * Renders `html`, connects the layer with both purposes granted and records each revocation.
 */
function openGranted(html: string, options: ScriptsOptions<PurposeId> = {}): RevokedPage {
  render(html);
  const events: RevokeEvent<PurposeId>[] = [];
  const page = openPage(
    { ...options, onRevoke: (event) => events.push(event) },
    { record: BOTH_GRANTED },
  );
  return { ...page, events };
}

describe('what counts as a revocation', () => {
  it('a decision that denies a granted purpose', () => {
    const { consent, events } = openGranted('');

    consent.decide({ analytics: 'denied' });

    assert.deepStrictEqual(events, [{ purposes: ['analytics'], requiresReload: false }]);
  });

  it('a restore from another tab that takes a grant away', () => {
    const { consent, events } = openGranted('');

    consent.restore(serialized({ ads: decisionOf('granted') }));

    assert.deepStrictEqual(events, [{ purposes: ['analytics'], requiresReload: false }]);
  });

  it('a restore in which the grant expired', () => {
    const { consent, clock, events } = openGranted('');
    clock.advance(400 * DAY);

    consent.restore(BOTH_GRANTED);

    assert.deepStrictEqual(events, [{ purposes: ['analytics', 'ads'], requiresReload: false }]);
  });

  it('not a refusal of a pending purpose', () => {
    render('');
    const events: RevokeEvent<PurposeId>[] = [];
    const { consent } = openPage({ onRevoke: (event) => events.push(event) });

    consent.denyAll();

    assert.deepStrictEqual(events, []);
  });

  it('lists the revoked purposes in configuration order, in a frozen event', () => {
    const { consent, events } = openGranted('');

    consent.decide({ ads: 'denied', analytics: 'denied' });

    const [event] = events;
    assert.deepStrictEqual(event?.purposes, ['analytics', 'ads']);
    assert.ok(Object.isFrozen(event));
    assert.ok(Object.isFrozen(event.purposes));
  });
});

describe("revocation: 'reload' (default)", () => {
  it('reloads in a microtask when the purpose activated a script on this page', async () => {
    const { consent, events } = openGranted(SCRIPT);

    consent.decide({ analytics: 'denied' });

    assert.equal(testDom.reloads(), 0);
    await flushMicrotasks();
    assert.equal(testDom.reloads(), 1);
    assert.deepStrictEqual(events, [{ purposes: ['analytics'], requiresReload: true }]);
  });

  it('reloads once for several revocations in the same task', async () => {
    const { consent, scripts } = openGranted(SCRIPT);
    scripts.onGranted('ads', () => undefined);

    consent.decide({ analytics: 'denied' });
    consent.decide({ ads: 'denied' });
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 1);
  });

  it('does not reload when nothing is left running: iframes and cleanups are stopped', async () => {
    const { consent, scripts, events } = openGranted(IFRAME);
    scripts.onGranted('ads', () => () => undefined);

    consent.decide({ ads: 'denied' });
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 0);
    assert.deepStrictEqual(events, [{ purposes: ['ads'], requiresReload: false }]);
  });

  it('does not reload for a script of another purpose, still granted', async () => {
    const { consent } = openGranted(SCRIPT);

    consent.decide({ ads: 'denied' });
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 0);
  });

  it('calls canReload in the microtask, after every listener received the notification', async () => {
    const log: string[] = [];
    const { consent } = openGranted(SCRIPT, {
      canReload: () => {
        log.push('canReload');
        return true;
      },
    });
    consent.subscribe(() => log.push('later listener'));

    consent.decide({ analytics: 'denied' });
    await flushMicrotasks();

    assert.deepStrictEqual(log, ['later listener', 'canReload']);
    assert.equal(testDom.reloads(), 1);
  });

  it('does not reload when canReload returns false', async () => {
    const { consent, events } = openGranted(SCRIPT, { canReload: () => false });

    consent.decide({ analytics: 'denied' });
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 0);
    assert.deepStrictEqual(events, [{ purposes: ['analytics'], requiresReload: true }]);
  });

  it('does not reload when canReload throws, and rethrows the error', (t) => {
    const scheduled = captureMicrotasks(t);
    const failure = new Error('faulty canReload');
    const { consent } = openGranted(SCRIPT, {
      canReload: () => {
        throw failure;
      },
    });

    consent.decide({ analytics: 'denied' });
    for (const callback of scheduled.splice(0)) callback(); // the reload microtask
    const [rethrow] = scheduled;

    assert.equal(testDom.reloads(), 0);
    assert.ok(rethrow);
    assert.throws(rethrow, (error) => error === failure);
  });

  it('drops a reload refused by canReload: a later revocation, once saved, reloads', async () => {
    let saved = false;
    const { consent, scripts } = openGranted(SCRIPT, { canReload: () => saved });
    scripts.onGranted('ads', () => undefined);

    consent.decide({ analytics: 'denied' });
    await flushMicrotasks();
    assert.equal(testDom.reloads(), 0);
    saved = true;
    consent.decide({ ads: 'denied' });
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 1);
  });

  it('after a refused reload, activates what was granted meanwhile and what is granted later', async () => {
    render(
      `${SCRIPT}<script type="text/plain" data-consent="health" id="meanwhile">a();</script><script type="text/plain" data-consent="ads" id="later">b();</script>`,
    );
    const { consent, scripts } = openPage(
      { canReload: () => false },
      { record: serialized({ analytics: decisionOf('granted', { version: '2026-10' }) }) },
    );

    consent.decide({ analytics: 'denied', health: 'granted' });
    assert.equal(find('#meanwhile').getAttribute('type'), 'text/plain');
    await flushMicrotasks();
    assert.equal(find('#meanwhile').getAttribute('type'), null);
    consent.decide({ ads: 'granted' });

    assert.equal(find('#later').getAttribute('type'), null);
    assert.equal(scripts.wouldReload({ health: 'denied' }), true);
  });

  it('does not reload when the layer is destroyed before the microtask', async () => {
    const { consent, scripts } = openGranted(SCRIPT);

    consent.decide({ analytics: 'denied' });
    scripts.destroy();
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 0);
  });

  it('activates nothing else once the reload is scheduled', () => {
    const { consent, scripts } = openGranted(
      `${SCRIPT}<script type="text/plain" data-consent="health" id="later">later();</script>`,
    );
    const log: string[] = [];
    scripts.onGranted('health', () => {
      log.push('fn ran');
    });

    consent.decide({ analytics: 'denied' });
    consent.decide({ health: 'granted' });

    assert.equal(find('#later').getAttribute('type'), 'text/plain');
    assert.deepStrictEqual(log, []);
  });
});

describe("revocation: 'manual'", () => {
  it('never reloads, and reports that a reload is required', async () => {
    const { consent, events } = openGranted(SCRIPT, { revocation: 'manual' });

    consent.decide({ analytics: 'denied' });
    await flushMicrotasks();

    assert.equal(testDom.reloads(), 0);
    assert.deepStrictEqual(events, [{ purposes: ['analytics'], requiresReload: true }]);
  });

  it('still cleans the page: iframes blocked again', () => {
    const { consent } = openGranted(IFRAME, { revocation: 'manual' });

    consent.decide({ ads: 'denied' });

    assert.equal(find('iframe').hasAttribute('src'), false);
  });

  it('keeps activating after a revocation, without running a script twice', () => {
    const { consent } = openGranted(
      `${SCRIPT}<script type="text/plain" data-consent="health" id="later">later();</script>`,
      { revocation: 'manual' },
    );

    consent.decide({ analytics: 'denied' });
    consent.decide({ analytics: 'granted', health: 'granted' });

    assert.equal(find('#later').getAttribute('type'), null);
    assert.equal(document.querySelectorAll('script[data-consent="analytics"]').length, 1);
  });
});

describe('onRevoke', () => {
  it('that throws is rethrown in a microtask, and the reload still happens', (t) => {
    const scheduled = captureMicrotasks(t);
    const failure = new Error('faulty onRevoke');
    render(SCRIPT);
    const { consent } = openPage(
      {
        onRevoke: () => {
          throw failure;
        },
      },
      { record: BOTH_GRANTED },
    );

    consent.decide({ analytics: 'denied' });
    const [rethrow, reload] = scheduled;
    reload?.();

    assert.ok(rethrow);
    assert.throws(rethrow, (error) => error === failure);
    assert.equal(testDom.reloads(), 1);
  });

  it('is not called when a cleanup destroyed the layer', () => {
    const { consent, scripts, events } = openGranted('');
    scripts.onGranted('ads', () => () => {
      scripts.destroy();
    });

    consent.decide({ ads: 'denied' });

    assert.deepStrictEqual(events, []);
  });

  it('runs after the page was cleaned', () => {
    render(IFRAME);
    let src: string | null = 'unset';
    openPage(
      {
        onRevoke: () => {
          src = find('iframe').getAttribute('src');
        },
      },
      { record: BOTH_GRANTED },
    ).consent.decide({ ads: 'denied' });

    assert.equal(src, null);
  });
});

describe('the state of the manager wins over the notification', () => {
  it('a listener that refuses while a grant is delivered keeps the script blocked', () => {
    render(SCRIPT);
    const tab = setup();
    // Subscribed before the layer: refuses during the delivery of the grant.
    tab.consent.subscribe(({ snapshot }) => {
      if (snapshot.status.analytics === 'granted') tab.consent.decide({ analytics: 'denied' });
    });
    const events: RevokeEvent<PurposeId>[] = [];
    const { consent } = connectPage(tab, { onRevoke: (event) => events.push(event) });

    consent.decide({ analytics: 'granted' });

    assert.equal(find('script').getAttribute('type'), 'text/plain');
    assert.deepStrictEqual(events, []);
  });

  it('a fn of onGranted that refuses is followed by the revocation of its purpose', async () => {
    render('');
    const events: RevokeEvent<PurposeId>[] = [];
    const { consent, scripts } = openPage({ onRevoke: (event) => events.push(event) });
    scripts.onGranted('analytics', () => {
      consent.decide({ analytics: 'denied' });
    });

    consent.decide({ analytics: 'granted' });
    await flushMicrotasks();

    assert.deepStrictEqual(events, [{ purposes: ['analytics'], requiresReload: true }]);
    assert.equal(testDom.reloads(), 1);
  });

  it('a fn of onGranted that refuses another purpose keeps the code of that purpose from running', () => {
    render('');
    const { consent, scripts } = openPage({ revocation: 'manual' });
    const log: string[] = [];
    scripts.onGranted('analytics', () => {
      consent.decide({ ads: 'denied' });
    });
    scripts.onGranted('ads', () => {
      log.push('ads ran');
    });

    consent.decide({ analytics: 'granted', ads: 'granted' });

    assert.deepStrictEqual(log, []);
    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });
  it('a fn that revokes its purpose when registered is followed by the revocation', async () => {
    const { consent, scripts, events } = openGranted('');

    scripts.onGranted('ads', () => {
      consent.decide({ ads: 'denied' });
    });
    await flushMicrotasks();

    assert.deepStrictEqual(events, [{ purposes: ['ads'], requiresReload: true }]);
    assert.equal(testDom.reloads(), 1);
  });

  it('a scan made by a fn of onGranted is applied before it returns', () => {
    const { scripts } = openGranted('<div id="widget"></div>');

    scripts.onGranted('ads', () => {
      find('#widget').innerHTML = '<script type="text/plain" data-consent="ads">widget();</script>';
      scripts.scan(find('#widget'));
      return () => undefined;
    });

    assert.equal(find('#widget script').getAttribute('type'), null);
  });
});

describe('wouldReload', () => {
  const PLAIN_OBJECT = '[lgpder] Choices must be a plain object.';

  it('is true when the choices revoke a purpose that left code running', () => {
    const { scripts } = openGranted(SCRIPT);

    assert.equal(scripts.wouldReload({ analytics: 'denied' }), true);
  });

  it('is false when the choices keep it, grant it or revoke a purpose with nothing running', () => {
    const { scripts } = openGranted(SCRIPT);

    for (const choices of [
      {},
      { analytics: 'granted' },
      { analytics: undefined },
      { ads: 'denied' },
    ]) {
      assert.equal(
        scripts.wouldReload(choices as Parameters<typeof scripts.wouldReload>[0]),
        false,
      );
    }
  });

  it("is false in the 'manual' mode", () => {
    const { scripts } = openGranted(SCRIPT, { revocation: 'manual' });

    assert.equal(scripts.wouldReload({ analytics: 'denied' }), false);
  });

  it('is false when the purpose is not granted now', () => {
    render(SCRIPT);
    const { scripts } = openPage();

    assert.equal(scripts.wouldReload({ analytics: 'denied' }), false);
  });

  const SAME_RULE: readonly {
    readonly case: string;
    readonly html: string;
    readonly options: ScriptsOptions<PurposeId>;
    readonly withCleanup: boolean;
    readonly expected: boolean;
  }[] = [
    { case: 'a script running', html: SCRIPT, options: {}, withCleanup: false, expected: true },
    { case: 'only a cleanup', html: '', options: {}, withCleanup: true, expected: false },
    {
      case: "the 'manual' mode",
      html: SCRIPT,
      options: { revocation: 'manual' },
      withCleanup: false,
      expected: false,
    },
  ];

  for (const { case: label, html, options, withCleanup, expected } of SAME_RULE) {
    it(`applies the same rule as the revocation, with ${label}`, async () => {
      const { consent, scripts } = openGranted(html, options);
      if (withCleanup) scripts.onGranted('analytics', () => () => undefined);

      const predicted = scripts.wouldReload({ analytics: 'denied' });
      consent.decide({ analytics: 'denied' });
      await flushMicrotasks();

      assert.equal(predicted, expected);
      assert.equal(testDom.reloads(), expected ? 1 : 0);
    });
  }

  it('accepts a null-prototype object', () => {
    const { scripts } = openGranted(SCRIPT);
    const choices = Object.assign(Object.create(null) as object, { analytics: 'denied' });

    assert.equal(callUntyped(scripts.wouldReload, choices), true);
  });

  const INVALID = [
    { case: 'null', choices: null, name: 'TypeError', message: PLAIN_OBJECT },
    { case: 'an array', choices: [], name: 'TypeError', message: PLAIN_OBJECT },
    { case: 'a Map', choices: new Map(), name: 'TypeError', message: PLAIN_OBJECT },
    {
      case: 'a purpose that is not configured',
      choices: { typo: 'denied' },
      name: 'RangeError',
      message: '[lgpder] Unknown purpose: "typo".',
    },
    {
      case: 'a value other than granted and denied',
      choices: { ads: 'revoked' },
      name: 'TypeError',
      message: '[lgpder] The choice for "ads" must be "granted" or "denied".',
    },
  ] as const;

  for (const { case: label, choices, name, message } of INVALID) {
    it(`throws ${name} for ${label}`, () => {
      const { scripts } = openGranted(SCRIPT);

      assert.throws(() => callUntyped(scripts.wouldReload, choices), { name, message });
    });
  }

  it('throws after destroy', () => {
    const { scripts } = openGranted(SCRIPT);
    scripts.destroy();

    assert.throws(() => scripts.wouldReload({}), {
      name: 'Error',
      message: '[lgpder] This instance was destroyed.',
    });
  });
});
