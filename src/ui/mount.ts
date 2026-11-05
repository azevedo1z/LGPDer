/**
 * The controller of the components: one subscription to the manager, from which the banner, the
 * preferences center and the floating button are rendered.
 */

import type { ConsentChoices, ConsentManager, DecidedStatus } from '../index.ts';
import { createBanner } from './banner.ts';
import { createButton } from './button.ts';
import { deepActiveElement, isFocusable } from './dom.ts';
import { defineElements, type Host } from './elements.ts';
import { callGuarded } from './guard.ts';
import { parsePurposeList, parseUiOptions, type UiOptions, type UiSettings } from './options.ts';
import { createPreferences } from './preferences.ts';

/**
 * Handle of the components. Frozen object; the functions do not depend on `this`. After
 * {@link ConsentUi.destroy}, `openPreferences` throws `Error('[lgpder] This instance was destroyed.')`.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface ConsentUi<P extends string = string> {
  /**
   * Opens the preferences center with every purpose and the section of the necessary cookies or,
   * given `purposes`, only with those: the way to ask for a decision on a purpose with
   * `individualGrant` where the feature that needs it is used.
   *
   * @throws {TypeError} `purposes` is neither `undefined` nor a non-empty array.
   * @throws {RangeError} `purposes` has a purpose that is not configured.
   */
  readonly openPreferences: (purposes?: readonly P[]) => void;
  /** Closes the center and removes the components. Idempotent. */
  readonly destroy: () => void;
}

const DESTROYED = '[lgpder] This instance was destroyed.';

/** Inline property of the root element that keeps the focus clear of the banner (WCAG 2.4.11). */
const PADDING = 'scroll-padding-bottom';

/** Whether the purpose is reached by "Aceitar todas": every one without `individualGrant`. */
function inBanner(purposes: ConsentManager['purposes'], id: string): boolean {
  return purposes[id]?.individualGrant !== true;
}

/** Renders the components on the page and returns what the handle drives. */
function createController(
  consent: ConsentManager,
  settings: UiSettings,
): { readonly open: (ids: readonly string[] | undefined) => void; readonly destroy: () => void } {
  const { purposes } = consent;
  const { actions } = settings;
  const ids = Object.keys(purposes);
  const bannerIds = ids.filter((id) => inBanner(purposes, id));
  // Purposes of the open center; empty while it is closed. Never empty while open: a list given to
  // openPreferences is not empty, and the manager has at least one purpose.
  let shown: readonly string[] = [];
  // Switches changed by the data subject since the center opened.
  const touched = new Map<string, DecidedStatus>();
  let returnFocus: Element | null = null;
  let attached = false;
  // Inline value and priority of the padding before the banner set it.
  let padding: readonly [string, string] | undefined;
  let unsubscribe: (() => void) | undefined;

  const isOpen = (): boolean => shown.length > 0;

  const isOn = (id: string): boolean => {
    const { status } = consent.getSnapshot();
    return (touched.get(id) ?? status[id]) === 'granted';
  };

  /**
   * What saving records: the switches changed, and the pending purposes the banner asks about,
   * saved off. Purposes already decided and left alone are omitted, so a page out of date never
   * writes back a grant revoked in another tab; so are the pending ones with `individualGrant`,
   * which the data subject did not consider.
   */
  const choices = (): ConsentChoices => {
    const { status } = consent.getSnapshot();
    const result: Record<string, DecidedStatus> = {};
    for (const id of shown) {
      const choice =
        touched.get(id) ??
        (status[id] === 'pending' && inBanner(purposes, id) ? 'denied' : undefined);
      if (choice !== undefined) result[id] = choice;
    }
    return result;
  };

  /**
   * Runs a decision action. When it throws, nothing closes, so the data subject sees that the
   * decision was not recorded, and the error is rethrown in a microtask.
   */
  const attempt = (action: () => void): boolean =>
    callGuarded(() => {
      action();
      return true;
    }) === true;

  const pad = (visible: boolean): void => {
    const { style } = document.documentElement;
    if (visible) {
      padding ??= [style.getPropertyValue(PADDING), style.getPropertyPriority(PADDING)];
      style.setProperty(PADDING, `${String(banner.offsetHeight)}px`);
    } else if (padding !== undefined) {
      style.setProperty(PADDING, ...padding);
      padding = undefined;
    }
  };

  /** Shows each component from the current state of the manager, while the ui is on the page. */
  const render = (): void => {
    if (!attached) return;
    const centerOpen = isOpen();
    const { status } = consent.getSnapshot();
    banner.hidden = centerOpen || !bannerIds.some((id) => status[id] === 'pending');
    button.host.hidden = !settings.floatingButton || centerOpen || !banner.hidden;
    preferences.host.hidden = !centerOpen;
    if (centerOpen) {
      preferences.update(isOn, callGuarded(() => settings.wouldReload(choices())) === true);
    }
    pad(!banner.hidden);
  };

  /** The height of the banner changes with the window (rotation, zoom); nothing else does. */
  const onResize = (): void => {
    if (!banner.hidden) pad(true);
  };

  const hosts = (): readonly Host[] => [banner, preferences.host, button.host];

  /** Whether `element` is on the page and outside a hidden component. */
  const isShown = (element: Element): boolean =>
    element.isConnected &&
    !hosts().some((host) => host.hidden && host.shadowRoot.contains(element));

  /** Moves the focus to `target` if it is shown, or else to the floating button if it is. */
  const restoreFocus = (target: Element | null): void => {
    if (target !== document.body && isFocusable(target) && isShown(target)) target.focus();
    else if (!button.host.hidden) button.focus();
  };

  /** Opens the center with `list`, or with every purpose and the necessary section. */
  const openCenter = (list: readonly string[] | undefined): void => {
    if (!isOpen()) returnFocus = deepActiveElement();
    shown = list ?? ids;
    touched.clear();
    preferences.build(shown, list === undefined);
    render();
    preferences.focusFirst();
  };

  const closeCenter = (): void => {
    shown = [];
    touched.clear();
    preferences.clear();
    render();
    const target = returnFocus;
    returnFocus = null;
    restoreFocus(target);
  };

  /** Runs an action of the banner; if the banner was focused and is gone, focuses the button. */
  const decideFromBanner = (action: () => void): void => {
    const focused = banner.shadowRoot.activeElement !== null;
    if (attempt(action) && focused && banner.hidden) restoreFocus(null);
  };

  const banner = createBanner(settings, bannerIds, {
    acceptAll: () => {
      decideFromBanner(() => {
        actions.grantAll();
      });
    },
    rejectAll: () => {
      decideFromBanner(() => {
        actions.denyAll();
      });
    },
    customize: () => {
      openCenter(undefined);
    },
  });
  const preferences = createPreferences(purposes, settings, {
    toggle: (id) => {
      touched.set(id, isOn(id) ? 'denied' : 'granted');
      render();
    },
    save: () => {
      const saved = attempt(() => {
        actions.decide(choices());
      });
      if (saved) closeCenter();
    },
    close: closeCenter,
  });
  const button = createButton(settings.texts, () => {
    openCenter(undefined);
  });

  /** Inserts the components first in the body, so the banner is first in the tab order. */
  const attach = (): void => {
    attached = true;
    document.body.prepend(...hosts());
    unsubscribe = consent.subscribe(render);
    window.addEventListener('resize', onResize);
    render();
    if (isOpen()) preferences.focusFirst();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();

  return {
    open: openCenter,
    destroy: () => {
      // Also stops the render that follows an action whose delivery destroyed the ui.
      attached = false;
      unsubscribe?.();
      document.removeEventListener('DOMContentLoaded', attach);
      window.removeEventListener('resize', onResize);
      const target = isOpen() ? returnFocus : null;
      preferences.clear();
      pad(false);
      for (const host of hosts()) host.remove();
      if (isFocusable(target) && target.isConnected) target.focus();
    },
  };
}

/**
 * Mounts the banner, the preferences center and the floating button, as Web Components with an
 * open shadow root, inserted first in the body (once the document is parsed). The components
 * render the current state of the manager and decide only through `actions`, on an explicit action
 * of the data subject.
 *
 * - Banner: shown while a purpose without `individualGrant` is `'pending'` (first visit, expired
 *   or outdated decision, storage failure) and the center is closed. "Aceitar todas" calls
 *   `grantAll`, "Rejeitar todas" calls `denyAll` and "Personalizar" opens the center; the three
 *   have the same emphasis.
 * - Center: one switch per purpose, grouped by category; pending purposes are off. Saving records
 *   the switches changed and, as refused, the pending purposes without `individualGrant`; the
 *   others are left as they are. The save button reads "Salvar e recarregar" when `wouldReload`
 *   says so. `Esc` and "Fechar" close without saving. The focus stays inside while it is open and
 *   goes back where it was, or to the floating button, when it closes.
 * - Floating button: shown while the banner and the center are hidden, unless
 *   `floatingButton: false`; it opens the center.
 *
 * An action that throws leaves the banner or the center open, and its error is rethrown in a
 * microtask. Outside the browser (no `document`), the options are validated and the handle does
 * nothing.
 *
 * @typeParam P - Union of the purpose ids.
 * @param consent - Manager whose state is shown.
 * @param options - Decision actions, texts, reload preview and floating button.
 * @returns Frozen handle.
 * @throws {TypeError} Invalid options.
 * @throws {RangeError} `options.purposes` has a purpose that is not configured.
 * @throws {Error} A custom element of the components is defined by another copy of the library.
 *
 * @example
 * ```ts
 * const consent = createConsentManager({ purposes: { analytics: { category: 'statistics' } } });
 * const storage = connectStorage(consent);
 * const ui = mountUi(consent, {
 *   actions: storage,
 *   purposes: { analytics: { title: 'Estatísticas', description: 'Google Analytics.' } },
 * });
 * ```
 */
export function mountUi<P extends string>(
  consent: ConsentManager<P>,
  options?: UiOptions<P>,
): ConsentUi<P>;
export function mountUi(consent: ConsentManager, options?: unknown): ConsentUi {
  const settings = parseUiOptions(consent, options);
  let controller: ReturnType<typeof createController> | undefined;
  if (typeof document !== 'undefined') {
    defineElements();
    controller = createController(consent, settings);
  }
  let destroyed = false;

  return Object.freeze({
    openPreferences: (purposes?: unknown): void => {
      if (destroyed) throw new Error(DESTROYED);
      const list = parsePurposeList(consent, purposes);
      controller?.open(list);
    },
    destroy: (): void => {
      if (destroyed) return;
      destroyed = true;
      controller?.destroy();
    },
  });
}
