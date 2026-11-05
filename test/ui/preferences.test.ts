/**
 * The preferences center: grouping, switches, the necessary section, what saving records (D52),
 * "Salvar e recarregar", openPreferences with a list (D54) and actions that throw (D57).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { connectScripts, type ConsentScripts } from '../../src/scripts/index.ts';
import { captureMicrotasks } from '../support/capture.ts';
import { testDom } from '../support/dom.ts';
import { decisionOf, serialized } from '../support/records.ts';
import { callUntyped, setup, type PurposeId } from '../support/setup.ts';
import {
  categories,
  clickButton,
  closeUis,
  failingActions,
  isOn,
  isShown,
  mountOn,
  openUi,
  parts,
  purposeTitles,
  recordingActions,
  switchOf,
  textsOf,
  type Screen,
} from '../support/ui.ts';

const connected: ConsentScripts<PurposeId>[] = [];

afterEach(() => {
  for (const scripts of connected.splice(0)) scripts.destroy();
  closeUis();
  testDom.reset();
});

/** Default fixture with the `ads` purpose granted; `analytics` and `health` pending. */
const ADS_GRANTED = serialized({ ads: decisionOf('granted') });

/** Mounts the default fixture with recording actions, from `record`, and opens the center. */
function openCenter(record?: string) {
  const tab = setup({ record });
  const recording = recordingActions(tab.consent);
  const screen = mountOn(tab, { actions: recording.actions });
  screen.ui.openPreferences();
  return { ...screen, calls: recording.calls };
}

/** The label of the save button, the last one of the footer. */
function saveLabel(): string | undefined {
  return parts('lgpder-preferences', 'footer')[0]?.lastElementChild?.textContent;
}

/** What the last call to decide recorded. */
function lastDecision(calls: ReturnType<typeof openCenter>['calls']): unknown {
  return calls.filter(([name]) => name === 'decide').at(-1)?.[1];
}

describe('the purposes of the center', () => {
  it('are grouped by category, in order of first appearance, with the titles of the texts', () => {
    openUi({ texts: { categories: { health: 'Saúde' } } });
    clickButton('lgpder-banner', 'Personalizar');

    assert.deepStrictEqual(categories(), [
      { title: 'Estatísticas', purposes: ['analytics'] },
      { title: 'Marketing', purposes: ['ads'] },
      { title: 'Saúde', purposes: ['health'] },
    ]);
  });

  it('a category without a title is shown by its id', () => {
    openUi();
    clickButton('lgpder-banner', 'Personalizar');

    assert.equal(categories()[2]?.title, 'health');
  });

  it('those without category go to a final group "Outras finalidades"', () => {
    const tab = setup({
      purposes: {
        newsletter: { category: 'marketing' },
        chat: {},
        stats: { category: 'statistics' },
        ads: { category: 'marketing' },
      },
    });
    mountOn(tab).ui.openPreferences();

    assert.deepStrictEqual(categories(), [
      { title: 'Marketing', purposes: ['newsletter', 'ads'] },
      { title: 'Estatísticas', purposes: ['stats'] },
      { title: 'Outras finalidades', purposes: ['chat'] },
    ]);
  });

  it('form a flat list, without category titles, when none declares a category', () => {
    const tab = setup({ purposes: { chat: {}, videos: {} } });
    mountOn(tab, { purposes: { videos: { title: 'Vídeos' } } }).ui.openPreferences();

    assert.deepStrictEqual(categories(), []);
    assert.deepStrictEqual(purposeTitles(), ['chat', 'Vídeos']);
  });

  it('have the title and the description of their texts', () => {
    openUi({
      purposes: { analytics: { title: 'Estatísticas', description: 'Google Analytics.' } },
    });
    clickButton('lgpder-banner', 'Personalizar');

    assert.deepStrictEqual(purposeTitles(), ['Estatísticas', 'ads', 'health']);
    assert.deepStrictEqual(textsOf('lgpder-preferences', 'purpose-description'), [
      'Google Analytics.',
    ]);
  });
});

describe('the switches of the center', () => {
  it('are one per purpose, without a switch for a category', () => {
    openCenter();

    assert.equal(parts('lgpder-preferences', 'switch').length, 3);
    assert.ok(
      parts('lgpder-preferences', 'category').every(
        (section) => section.querySelectorAll('[role="switch"]').length === 1,
      ),
    );
  });

  it('show pending purposes off, granted on and denied off', () => {
    openCenter(
      serialized({ ads: decisionOf('granted'), health: decisionOf('denied', { version: '1' }) }),
    );

    assert.deepStrictEqual(
      ['analytics', 'ads', 'health'].map((title) => isOn(title)),
      [false, true, false],
    );
  });

  it('are labelled by the title and described by the description of the purpose', () => {
    openUi({
      purposes: { analytics: { title: 'Estatísticas', description: 'Google Analytics.' } },
    });
    clickButton('lgpder-banner', 'Personalizar');

    const toggle = switchOf('Estatísticas');
    const root = toggle.getRootNode() as ShadowRoot;
    assert.equal(
      root.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent,
      'Google Analytics.',
    );
    assert.equal(switchOf('ads').hasAttribute('aria-describedby'), false);
  });

  it('turn on and off on click, without deciding', () => {
    const { calls } = openCenter();

    switchOf('analytics').click();
    assert.equal(isOn('analytics'), true);
    switchOf('analytics').click();
    assert.equal(isOn('analytics'), false);
    assert.deepStrictEqual(calls, []);
  });
});

describe('a purpose with individualGrant in the center', () => {
  it('is highlighted, with its own switch and the badge, which also describes the switch', () => {
    openUi({ purposes: { health: { description: 'Dados de saúde.' } } });
    clickButton('lgpder-banner', 'Personalizar');

    const [individual] = parts('lgpder-preferences', 'individual');
    assert.equal(individual?.getAttribute('part'), 'purpose individual');
    assert.equal(parts('lgpder-preferences', 'individual').length, 1);
    assert.deepStrictEqual(textsOf('lgpder-preferences', 'badge'), [
      'Exige sua autorização específica',
    ]);
    const root = switchOf('health').getRootNode() as ShadowRoot;
    const describedBy = (switchOf('health').getAttribute('aria-describedby') ?? '').split(' ');
    assert.deepStrictEqual(
      describedBy.map((id) => root.getElementById(id)?.textContent),
      ['Exige sua autorização específica', 'Dados de saúde.'],
    );
  });
});

describe('the necessary section', () => {
  it('is in the full center, without a switch, with the built-in texts', () => {
    openCenter();

    const [section] = parts('lgpder-preferences', 'necessary');
    assert.ok(section);
    assert.equal(section.querySelector('h3')?.textContent, 'Necessários (sempre ativos)');
    assert.match(section.querySelector('p')?.textContent ?? '', /^Essenciais para o funcionamento/);
    assert.equal(section.querySelector('[role="switch"]'), null);
  });

  it('takes the texts of texts.necessary', () => {
    openUi({
      texts: { necessary: { title: 'Cookies essenciais', description: 'Sessão e segurança.' } },
    });
    clickButton('lgpder-banner', 'Personalizar');

    const [section] = parts('lgpder-preferences', 'necessary');
    assert.deepStrictEqual(
      [section?.querySelector('h3')?.textContent, section?.querySelector('p')?.textContent],
      ['Cookies essenciais', 'Sessão e segurança.'],
    );
  });
});

describe('saving the center records only what the data subject decided (D52)', () => {
  it('untouched: a pending purpose without individualGrant is denied; the others are omitted', () => {
    const { calls } = openCenter(ADS_GRANTED);

    clickButton('lgpder-preferences', 'Salvar');

    assert.deepStrictEqual(lastDecision(calls), { analytics: 'denied' });
  });

  it('touched: the value of the switch, for any purpose', () => {
    const { calls } = openCenter(ADS_GRANTED);

    switchOf('analytics').click();
    switchOf('health').click();
    switchOf('ads').click();
    clickButton('lgpder-preferences', 'Salvar');

    assert.deepStrictEqual(lastDecision(calls), {
      analytics: 'granted',
      ads: 'denied',
      health: 'granted',
    });
  });

  it('a switch turned off and on again records its final value', () => {
    const { calls } = openCenter(ADS_GRANTED);

    switchOf('ads').click();
    switchOf('ads').click();
    clickButton('lgpder-preferences', 'Salvar');

    assert.deepStrictEqual(lastDecision(calls), { analytics: 'denied', ads: 'granted' });
  });

  it('untouched switches follow the state, so a revocation made elsewhere is never written back', () => {
    const { consent, calls } = openCenter(ADS_GRANTED);

    consent.restore(serialized({ ads: decisionOf('denied') }));
    assert.equal(isOn('ads'), false);
    clickButton('lgpder-preferences', 'Salvar');

    assert.deepStrictEqual(lastDecision(calls), { analytics: 'denied' });
    assert.equal(consent.getSnapshot().status.ads, 'denied');
  });

  it('a touched switch keeps its value across notifications', () => {
    const { consent } = openCenter();

    switchOf('analytics').click();
    consent.decide({ analytics: 'denied' });

    assert.equal(isOn('analytics'), true);
  });

  it('saving closes the center and the banner goes away', () => {
    openCenter();

    clickButton('lgpder-preferences', 'Salvar');

    assert.equal(isShown('lgpder-preferences'), false);
    assert.equal(isShown('lgpder-banner'), false);
  });

  it('"Fechar" closes without deciding, and a new opening forgets the switches touched', () => {
    const { ui, calls } = openCenter();

    switchOf('analytics').click();
    clickButton('lgpder-preferences', 'Fechar');
    ui.openPreferences();

    assert.deepStrictEqual(calls, []);
    assert.equal(isOn('analytics'), false);
  });
});

describe('the save button reads "Salvar e recarregar"', () => {
  /** Mounts the default fixture with `wouldReload` and opens the center. */
  function openWithReload(wouldReload: Parameters<typeof mountOn<PurposeId>>[1]): Screen {
    const screen = mountOn(setup({ record: ADS_GRANTED }), wouldReload);
    screen.ui.openPreferences();
    return screen;
  }

  it('when wouldReload says the choices reload, recomputed on each toggle', () => {
    const asked: unknown[] = [];
    openWithReload({
      wouldReload: (choices) => {
        asked.push(choices);
        return choices.ads === 'denied';
      },
    });

    assert.equal(saveLabel(), 'Salvar');
    switchOf('ads').click();
    assert.equal(saveLabel(), 'Salvar e recarregar');
    switchOf('ads').click();
    assert.equal(saveLabel(), 'Salvar');
    assert.deepStrictEqual(asked.at(-2), { analytics: 'denied', ads: 'denied' });
  });

  it('from wouldReload of the scripts layer, when a script of the purpose ran', () => {
    document.body.innerHTML =
      '<script type="text/plain" data-consent="ads">window.ads = 1;</script>';
    const tab = setup({ record: ADS_GRANTED });
    const scripts = connectScripts(tab.consent);
    connected.push(scripts);
    mountOn(tab, { wouldReload: scripts.wouldReload }).ui.openPreferences();

    switchOf('ads').click();

    assert.equal(saveLabel(), 'Salvar e recarregar');
  });

  it('never when wouldReload throws: the error is rethrown in a microtask', (t) => {
    const scheduled = captureMicrotasks(t);
    const failure = new Error('faulty wouldReload');
    openWithReload({
      wouldReload: () => {
        throw failure;
      },
    });

    assert.equal(saveLabel(), 'Salvar');
    assert.throws(() => {
      scheduled[0]?.();
    }, failure);
  });
});

describe('openPreferences with a list of purposes (D54)', () => {
  it('shows only those, in configuration order and once each, without the necessary section', () => {
    const { ui } = openUi();

    ui.openPreferences(['health', 'analytics', 'health']);

    assert.deepStrictEqual(purposeTitles(), ['analytics', 'health']);
    assert.deepStrictEqual(parts('lgpder-preferences', 'necessary'), []);
  });

  it('saving decides only the purposes listed', () => {
    const tab = setup();
    const recording = recordingActions(tab.consent);
    const { ui } = mountOn(tab, { actions: recording.actions });

    ui.openPreferences(['health']);
    switchOf('health').click();
    clickButton('lgpder-preferences', 'Salvar');

    assert.deepStrictEqual(recording.calls, [['decide', { health: 'granted' }]]);
    assert.equal(tab.consent.getSnapshot().status.analytics, 'pending');
  });

  it('a pending individualGrant purpose saved untouched stays pending', () => {
    const tab = setup();
    const recording = recordingActions(tab.consent);
    const { ui } = mountOn(tab, { actions: recording.actions });

    ui.openPreferences(['health']);
    clickButton('lgpder-preferences', 'Salvar');

    assert.deepStrictEqual(recording.calls, [['decide', {}]]);
    assert.equal(tab.consent.getSnapshot().status.health, 'pending');
  });

  it('called while open, replaces the content', () => {
    const { ui } = openUi();
    ui.openPreferences(['ads']);

    ui.openPreferences(['health']);

    assert.deepStrictEqual(purposeTitles(), ['health']);
  });

  it('rejects a list that is not a non-empty array of configured purposes', () => {
    const { ui } = openUi();

    const open = (purposes: unknown) => (): void => {
      callUntyped(ui.openPreferences, purposes);
    };

    assert.throws(open(['typo']), {
      name: 'RangeError',
      message: '[lgpder] Unknown purpose: "typo".',
    });
    assert.throws(open([1]), { name: 'RangeError', message: '[lgpder] Unknown purpose: "1".' });
    for (const value of ['ads', [], {}, null]) {
      assert.throws(open(value), {
        name: 'TypeError',
        message: '[lgpder] "purposes" must be a non-empty array.',
      });
    }
    // eslint-disable-next-line no-sparse-arrays -- a hole, which an untyped caller may pass
    assert.throws(open([, 'ads']), RangeError);
    assert.equal(isShown('lgpder-preferences'), false);
  });
});

describe('an action that throws (D57)', () => {
  it('leaves the center open, with the switches as they were, and rethrows in a microtask', (t) => {
    const scheduled = captureMicrotasks(t);
    const failure = new Error('faulty clock');
    const { ui } = mountOn(setup(), { actions: failingActions(failure) });
    ui.openPreferences();

    switchOf('analytics').click();
    clickButton('lgpder-preferences', 'Salvar');

    assert.equal(isShown('lgpder-preferences'), true);
    assert.equal(isOn('analytics'), true);
    assert.throws(() => {
      scheduled[0]?.();
    }, failure);
  });

  it('leaves the banner shown after "Aceitar todas" or "Rejeitar todas"', (t) => {
    const scheduled = captureMicrotasks(t);
    const failure = new Error('faulty clock');
    mountOn(setup(), { actions: failingActions(failure) });

    clickButton('lgpder-banner', 'Aceitar todas');
    clickButton('lgpder-banner', 'Rejeitar todas');

    assert.equal(isShown('lgpder-banner'), true);
    assert.equal(scheduled.length, 2);
  });
});
