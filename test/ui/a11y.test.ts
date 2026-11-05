/** axe on each component, with the WCAG 2.2 AA rules and the best practices (D58). */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { connectScripts, type ConsentScripts } from '../../src/scripts/index.ts';
import { createPlaceholder } from '../../src/ui/index.ts';
import { describeViolations, runAxe } from '../support/axe.ts';
import { testDom } from '../support/dom.ts';
import { setup, type PurposeId } from '../support/setup.ts';
import { categories, clickButton, closeUis, host, mountOn, openUi } from '../support/ui.ts';

const TEXTS = {
  analytics: { title: 'Estatísticas', description: 'Google Analytics.' },
  ads: { title: 'Publicidade', description: 'Google Ads.' },
  health: { title: 'Saúde', description: 'Dados de saúde.' },
} as const;

const connected: ConsentScripts<PurposeId>[] = [];

afterEach(() => {
  for (const scripts of connected.splice(0)) scripts.destroy();
  closeUis();
  testDom.reset();
});

/** Asserts that axe finds no violation in the component on the page. */
async function assertAccessible(tag: Parameters<typeof host>[0]): Promise<void> {
  const results = await runAxe(host(tag));

  assert.deepStrictEqual(describeViolations(results), []);
  assert.ok(results.passes.length > 0, 'axe checked nothing');
}

describe('the axe harness', () => {
  it('reports a violation inside the shadow root of a host', async () => {
    const element = document.createElement('div');
    element.attachShadow({ mode: 'open' }).innerHTML =
      '<button type="button" role="switch"></button>';
    document.body.append(element);

    const results = await runAxe(element);

    assert.ok(results.violations.some(({ id }) => id === 'aria-required-attr'));
  });
});

describe('axe finds no violation', () => {
  it('in the banner', async () => {
    openUi({ purposes: TEXTS });

    await assertAccessible('lgpder-banner');
  });

  it('in the full preferences center, with categories, necessary section and individualGrant', async () => {
    openUi({ purposes: TEXTS });
    clickButton('lgpder-banner', 'Personalizar');

    await assertAccessible('lgpder-preferences');
  });

  it('in the preferences center as a flat list of purposes without texts', async () => {
    const { ui } = mountOn(setup({ purposes: { chat: {}, videos: {} } }));
    ui.openPreferences(['chat', 'videos']);
    assert.deepStrictEqual(categories(), []);

    await assertAccessible('lgpder-preferences');
  });

  it('in the floating button', async () => {
    const { consent } = openUi({ purposes: TEXTS });
    consent.denyAll();

    await assertAccessible('lgpder-button');
  });

  it('in the placeholder of an iframe', async () => {
    document.body.innerHTML =
      '<iframe data-consent="ads" data-src="https://video.example/"></iframe>';
    const { consent } = setup();
    connected.push(
      connectScripts(consent, {
        renderPlaceholder: createPlaceholder(consent, { purposes: TEXTS }),
      }),
    );

    await assertAccessible('lgpder-placeholder');
  });
});
