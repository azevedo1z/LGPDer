/**
 * LGPDer init: one call that creates the consent manager and connects every layer to it, the
 * storage, the Google Consent Mode, the evidence, the components and the blocking of scripts.
 *
 * The configuration of each purpose takes, together, the keys of the core, its texts, its
 * integrations, its cookies and its Consent Mode types; `init` hands each part to its layer. Every
 * layer validates its options before any effect, and a layer that refuses them undoes the ones
 * already connected, so a failed `init` leaves nothing on the page.
 *
 * @packageDocumentation
 */

import {
  createConsentManager,
  type ConsentChoices,
  type ConsentManager,
  type ConsentOptions,
  type PurposeConfig,
} from '../index.ts';
import { connectEvidence, type EvidenceOptions } from '../evidence/index.ts';
import { connectGoogle, type GooglePurposeOptions } from '../google/index.ts';
import {
  connectScripts,
  type ConsentScripts,
  type ScriptsOptions,
  type ScriptsPurposeOptions,
} from '../scripts/index.ts';
import { connectStorage, type StorageOptions } from '../storage/index.ts';
import {
  createPlaceholder,
  mountUi,
  type ConsentUi,
  type UiOptions,
  type UiPurposeTexts,
  type UiTextsOverride,
} from '../ui/index.ts';

/* eslint-disable @typescript-eslint/consistent-indexed-object-style -- the mapped type of
 * `InitOptions.purposes` is the shape of the published API, as in the core. */

/**
 * Configuration of a purpose in {@link InitOptions.purposes}: the keys of the core, the texts of
 * the components, the integrations and cookies of the scripts layer and the Consent Mode types of
 * the google layer.
 *
 * @typeParam C - Union of the category ids.
 */
export interface InitPurpose<C extends string = string>
  extends PurposeConfig<C>, UiPurposeTexts, ScriptsPurposeOptions {
  /**
   * Google Consent Mode types controlled by the purpose, besides the ones of its integrations
   * (`'google-analytics'` controls `analytics_storage`; `'google-ads'` controls `ad_storage`,
   * `ad_user_data` and `ad_personalization`).
   */
  readonly consentMode?: GooglePurposeOptions['consentMode'];
}

/**
 * Options of {@link init}. Read only as own properties; unknown keys are rejected, and so is
 * `record`: an external record is adopted with {@link ConsentApp.adopt}.
 *
 * @typeParam P - Union of the purpose ids.
 * @typeParam C - Union of the category ids.
 */
export interface InitOptions<P extends string = string, C extends string = string> {
  /** Purposes, indexed by id, in the order they are shown; at least one. */
  readonly purposes: { readonly [K in P]: InitPurpose<C> };
  /**
   * Where the record is saved: `'localStorage'` (default), `'cookie'`, named `lgpder`, or an
   * adapter of the application. With `'cookie'`, a cookie pattern of a purpose that matches
   * `lgpder` is refused, since removing it would lose the record.
   */
  readonly storage?: StorageOptions['storage'];
  /** What a revocation that left code running does: `'reload'` (default) or `'manual'`. */
  readonly revocation?: ScriptsOptions<P>['revocation'];
  /** Called on every revocation, in both modes, after the page was cleaned. */
  readonly onRevoke?: ScriptsOptions<P>['onRevoke'];
  /** Maximum age of a decision, in milliseconds. Default: 365 days. */
  readonly maxAge?: ConsentOptions['maxAge'];
  /** Clock of the decisions. Default: the start of the current UTC day. */
  readonly now?: ConsentOptions['now'];
  /** Address that receives the evidence of each decision, by POST. Nothing is sent without it. */
  readonly endpoint?: EvidenceOptions<P>['endpoint'];
  /** Called on each decision of the data subject, before the evidence is sent. */
  readonly onDecision?: EvidenceOptions<P>['onDecision'];
  /** Called when sending the evidence fails; requires `endpoint` or `onDecision`. */
  readonly onError?: EvidenceOptions<P>['onError'];
  /** Texts of the section of the necessary cookies; same as `texts.necessary`, which it excludes. */
  readonly necessary?: UiTextsOverride['necessary'];
  /** Texts of the components, merged over the built-in Brazilian Portuguese. */
  readonly texts?: UiOptions<P>['texts'];
  /** Whether to show the floating button that reopens the preferences. Default: `true`. */
  readonly floatingButton?: UiOptions<P>['floatingButton'];
  /** Warns in the console about elements, scripts and tags that are not blocked as expected. */
  readonly debug?: ScriptsOptions<P>['debug'];
}

/* eslint-enable @typescript-eslint/consistent-indexed-object-style */

/**
 * What {@link init} returns. Frozen object; the functions do not depend on `this`. After
 * {@link ConsentApp.destroy}, every other function throws
 * `Error('[lgpder] This instance was destroyed.')`, and `manager` stays usable.
 *
 * @typeParam P - Union of the purpose ids.
 * @typeParam C - Union of the category ids.
 */
export interface ConsentApp<P extends string = string, C extends string = string> {
  /**
   * The manager, to read the state and subscribe to it. Decisions made here skip the adoption of
   * the saved record that precedes each decision: decide through the actions below.
   */
  readonly manager: ConsentManager<P, C>;
  /** Adopts the saved record, then decides. Only on an explicit action of the data subject. */
  readonly decide: (choices: ConsentChoices<P>) => void;
  /** Adopts the saved record, then grants every purpose without `individualGrant`. */
  readonly grantAll: () => void;
  /** Adopts the saved record, then refuses every purpose. */
  readonly denyAll: () => void;
  /** Adopts an external record, such as the one of the backend, and saves it. */
  readonly adopt: (record: unknown) => void;
  /** Adopts the saved record if it changed since this page last read or wrote it. */
  readonly sync: () => void;
  /** Opens the preferences center, with every purpose or only the ones listed. */
  readonly openPreferences: ConsentUi<P>['openPreferences'];
  /** Runs code of the application while a purpose is granted. */
  readonly onGranted: ConsentScripts<P>['onGranted'];
  /** Processes the `[data-consent]` elements inserted after `init`. */
  readonly scan: ConsentScripts<P>['scan'];
  /** Disconnects every layer and removes the components. Idempotent. */
  readonly destroy: () => void;
}

/** An object read only through its own properties. */
type Own = Record<string, unknown>;

/**
 * Key of the record, given to the storage layer: the `localStorage` key, the cookie name and the
 * name of the `BroadcastChannel`.
 */
const RECORD_KEY = 'lgpder';

/** Options of init that are not the core's, which receives the others and rejects the unknown. */
const LAYER_OPTIONS = [
  'storage',
  'revocation',
  'onRevoke',
  'endpoint',
  'onDecision',
  'onError',
  'necessary',
  'texts',
  'floatingButton',
  'debug',
] as const;

/** Options of init handed to the layers, as given. */
type LayerOptions = Pick<InitOptions, (typeof LAYER_OPTIONS)[number]>;

/** Keys of a purpose that are not the core's. */
const TEXT_KEYS = ['title', 'description'] as const;
const LIST_KEYS = ['integrations', 'cookies', 'consentMode'] as const;

/** Lists of a purpose, as given. */
type PurposeLists = Pick<InitPurpose, (typeof LIST_KEYS)[number]>;

/** The options of init split between the core and the layers, in null-prototype objects. */
interface SplitOptions {
  /** Options of the core: its keys and the unknown ones, which it refuses. */
  readonly core: ConsentOptions;
  /** Options of init that are not the core's, as given. */
  readonly layers: LayerOptions;
  /** Texts of each purpose, for the components. */
  readonly texts: Readonly<Record<string, UiPurposeTexts>>;
  /** `texts`, with `necessary` as its `necessary` group. */
  readonly uiTexts: UiOptions['texts'];
  /** Integrations and cookies of each purpose, for the scripts layer. */
  readonly scriptsPurposes: Readonly<Record<string, ScriptsPurposeOptions>>;
  /** Integrations and Consent Mode types of each purpose, for the google layer. */
  readonly googlePurposes: Readonly<Record<string, GooglePurposeOptions>>;
  /** Whether some purpose may map a Consent Mode type, so that the google layer is connected. */
  readonly mapped: boolean;
}

/** The instance alive on this page, in the browser. */
let live: object | undefined;

/**
 * Copies the own enumerable properties of `value` to a null-prototype object, so that a property
 * planted on a polluted prototype, such as an `endpoint` of another site, is never read.
 *
 * @throws {TypeError} `value` is not an object, with `message`.
 */
function copyOwn(value: unknown, message: string): Own {
  if (typeof value !== 'object' || value === null) throw new TypeError(message);
  return Object.assign(Object.create(null) as Own, value);
}

/** Moves `keys` out of `own` into a new null-prototype object; absent keys are `undefined`. */
function take(own: Own, keys: readonly string[]): Own {
  const taken = Object.create(null) as Own;
  for (const key of keys) {
    taken[key] = own[key];
    Reflect.deleteProperty(own, key);
  }
  return taken;
}

/** Whether a list of `integrations` or `consentMode` may map a consent type: absent or empty do not. */
function maps(list: unknown): boolean {
  return list !== undefined && !(Array.isArray(list) && list.length === 0);
}

/**
 * Refuses a cookie pattern that matches the cookie of the record: removing it on a revocation
 * would lose the decision just saved. Anything else is validated by the scripts layer.
 *
 * @throws {TypeError} A pattern of `cookies` matches {@link RECORD_KEY}.
 */
function assertKeepsRecord(id: string, cookies: unknown): void {
  if (!Array.isArray(cookies)) return;
  for (const pattern of cookies as unknown[]) {
    if (
      typeof pattern === 'string' &&
      (pattern.endsWith('*') ? RECORD_KEY.startsWith(pattern.slice(0, -1)) : pattern === RECORD_KEY)
    ) {
      throw new TypeError(
        `[lgpder] The cookie pattern ${JSON.stringify(pattern)} of ${JSON.stringify(id)} matches the cookie of the consent record.`,
      );
    }
  }
}

/**
 * `texts` with `necessary` as its `necessary` group.
 *
 * @throws {TypeError} `texts` is not an object, or already has `necessary`.
 */
function withNecessary(texts: unknown, necessary: unknown): UiTextsOverride {
  const own = texts === undefined ? {} : copyOwn(texts, '[lgpder] "texts" must be an object.');
  if (own['necessary'] !== undefined) {
    throw new TypeError('[lgpder] Use "necessary" or "texts.necessary", not both.');
  }
  return { ...own, necessary } as UiTextsOverride;
}

/**
 * Splits the options among the core and the layers. Each purpose leaves its texts to the
 * components, its integrations and cookies to the scripts layer and its integrations and Consent
 * Mode types to the google layer; what is left of it, its core keys and any unknown one, goes to
 * the core, and so do the options of init that are not a layer's.
 *
 * @throws {TypeError} Options, `purposes` or a purpose that are not objects; `record`; a cookie
 * pattern that matches the cookie of the record; `necessary` with `texts.necessary`.
 */
function splitOptions(options: unknown): SplitOptions {
  const core = copyOwn(options, '[lgpder] Options must be an object.');
  // The core would hydrate it, and the first sync of the storage would replace it right away.
  if ('record' in core) throw new TypeError('[lgpder] Unknown option: "record".');
  const layers = take(core, LAYER_OPTIONS) as LayerOptions;
  const purposes = copyOwn(core['purposes'], '[lgpder] "purposes" must be an object.');
  // Per layer, null-prototype objects: a purpose id is never a property of Object.prototype.
  const texts = Object.create(null) as Record<string, UiPurposeTexts>;
  const scriptsPurposes = Object.create(null) as Record<string, ScriptsPurposeOptions>;
  const googlePurposes = Object.create(null) as Record<string, GooglePurposeOptions>;
  let mapped = false;
  for (const [id, value] of Object.entries(purposes)) {
    const purpose = copyOwn(
      value,
      `[lgpder] The configuration of purpose ${JSON.stringify(id)} must be an object.`,
    );
    purposes[id] = purpose;
    texts[id] = take(purpose, TEXT_KEYS);
    const { integrations, cookies, consentMode } = take(purpose, LIST_KEYS) as PurposeLists;
    scriptsPurposes[id] = { integrations, cookies };
    googlePurposes[id] = { integrations, consentMode };
    mapped ||= maps(integrations) || maps(consentMode);
    if (layers.storage === 'cookie') assertKeepsRecord(id, cookies);
  }
  core['purposes'] = purposes;
  const { necessary } = layers;
  return {
    core: core as unknown as ConsentOptions,
    layers,
    texts,
    uiTexts: necessary === undefined ? layers.texts : withNecessary(layers.texts, necessary),
    scriptsPurposes,
    googlePurposes,
    mapped,
  };
}

/**
 * Creates the consent manager and connects every layer to it, in this order: the storage, which
 * saves each decision before the other layers react to it; the Google Consent Mode, so that its
 * update reaches the dataLayer before the tags a grant activates, connected only when some purpose
 * maps a consent type; the evidence, connected only with `endpoint`, `onDecision` or `onError`; the
 * components; and the blocking of scripts, the only effect that cannot be undone. A layer that
 * refuses its options throws before any effect of its own, and the layers already connected are
 * disconnected before the error is rethrown.
 *
 * The decisions go through the storage: the components call its actions, the reload of a
 * revocation happens only when the storage confirms the record saved, and the returned app exposes
 * them. In the browser, only one instance may be alive: call {@link ConsentApp.destroy} before
 * calling `init` again. Outside the browser (no `document`), the options are validated and the app
 * works in memory, with every layer inert.
 *
 * @typeParam P - Union of the purpose ids.
 * @typeParam C - Union of the category ids (`never` when no purpose declares a category).
 * @param options - Purposes and the options of the layers.
 * @returns Frozen app.
 * @throws {TypeError} Invalid options.
 * @throws {Error} Another instance is alive on this page, or a custom element of the components is
 * defined by another copy of the library.
 *
 * @example
 * ```ts
 * init({
 *   purposes: {
 *     analytics: {
 *       category: 'statistics',
 *       title: 'Estatísticas',
 *       description: 'Usamos o Google Analytics para entender como o site é usado.',
 *       integrations: ['google-analytics'],
 *     },
 *   },
 * });
 * ```
 */
export function init<P extends string, C extends string = never>(
  options: InitOptions<P, C>,
): ConsentApp<P, C>;
export function init(options: unknown): ConsentApp {
  const { core, layers, texts, uiTexts, scriptsPurposes, googlePurposes, mapped } =
    splitOptions(options);
  const { endpoint, onDecision, onError } = layers;

  const inBrowser = typeof document !== 'undefined';
  if (inBrowser && live !== undefined) {
    throw new Error('[lgpder] init() was already called; call destroy() first.');
  }
  const instance = {};
  if (inBrowser) live = instance;
  // Destroy functions of the layers connected so far, in creation order.
  const created: (() => void)[] = [];
  const destroy = (): void => {
    for (const destroyLayer of created.splice(0).reverse()) destroyLayer();
    if (live === instance) live = undefined;
  };

  try {
    const manager = createConsentManager(core);
    const storage = connectStorage(manager, { storage: layers.storage, key: RECORD_KEY });
    created.push(storage.destroy);
    if (mapped) {
      created.push(
        connectGoogle(manager, { purposes: googlePurposes, debug: layers.debug }).destroy,
      );
    }
    if (endpoint !== undefined || onDecision !== undefined || onError !== undefined) {
      created.push(connectEvidence(manager, { endpoint, onDecision, onError }).destroy);
    }
    const uiOptions = { actions: storage, purposes: texts, texts: uiTexts };
    const renderPlaceholder = createPlaceholder(manager, uiOptions);
    // Bound late: the scripts layer is connected last, after the components.
    let wouldReload: ConsentScripts['wouldReload'] = () => false;
    const ui = mountUi(manager, {
      ...uiOptions,
      wouldReload: (choices) => wouldReload(choices),
      floatingButton: layers.floatingButton,
    });
    created.push(ui.destroy);
    const scripts = connectScripts(manager, {
      purposes: scriptsPurposes,
      revocation: layers.revocation,
      onRevoke: layers.onRevoke,
      renderPlaceholder,
      canReload: storage.isPersisted,
      debug: layers.debug,
    });
    created.push(scripts.destroy);
    wouldReload = scripts.wouldReload;

    return Object.freeze({
      manager,
      decide: storage.decide,
      grantAll: storage.grantAll,
      denyAll: storage.denyAll,
      adopt: storage.adopt,
      sync: storage.sync,
      openPreferences: ui.openPreferences,
      onGranted: scripts.onGranted,
      scan: scripts.scan,
      destroy,
    });
  } catch (error) {
    destroy();
    throw error;
  }
}
