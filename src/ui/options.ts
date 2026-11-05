/**
 * Options of the ui layer: the public types, and their validation, which runs in full before any
 * effect. Options are read only as own properties (a polluted prototype could otherwise hide the
 * floating button, the access to the revocation).
 */

import type { ConsentChoices, ConsentManager } from '../index.ts';
import { ptBR, type UiTexts, type UiTextsOverride } from './texts.ts';

/* eslint-disable @typescript-eslint/consistent-indexed-object-style -- the mapped type of
 * `PlaceholderOptions.purposes` is the shape of the published API, as in the core. */

/** Texts of one purpose. */
export interface UiPurposeTexts {
  /** Title shown for the purpose. Default: its id. */
  readonly title?: string | undefined;
  readonly description?: string | undefined;
}

/**
 * Decision actions the components call: the actions of the storage layer, which adopt the saved
 * record before deciding, or the manager itself.
 *
 * @typeParam P - Union of the purpose ids.
 */
export type UiActions<P extends string = string> = Pick<
  ConsentManager<P>,
  'decide' | 'grantAll' | 'denyAll'
>;

/**
 * Options of `createPlaceholder`. Read only as own properties; unknown keys are rejected.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface PlaceholderOptions<P extends string = string> {
  /** Decision actions. Default: the manager. */
  readonly actions?: UiActions<P> | undefined;
  /** Title and description of each purpose. */
  readonly purposes?: { readonly [K in P]?: UiPurposeTexts } | undefined;
  /** Texts merged over the built-in Brazilian Portuguese. */
  readonly texts?: UiTextsOverride | undefined;
}

/**
 * Options of `mountUi`. Read only as own properties; unknown keys are rejected.
 *
 * @typeParam P - Union of the purpose ids.
 */
export interface UiOptions<P extends string = string> extends PlaceholderOptions<P> {
  /**
   * Whether saving these choices would reload the page, such as `wouldReload` of the scripts
   * layer; the save button then reads "Salvar e recarregar". Default: `() => false`.
   */
  readonly wouldReload?: ((choices: ConsentChoices<P>) => boolean) | undefined;
  /**
   * Whether to show the floating button that reopens the preferences. Hide it only if the
   * application offers another access, through `openPreferences`: revoking must be as easy as
   * granting. Default: `true`.
   */
  readonly floatingButton?: boolean | undefined;
}

/* eslint-enable @typescript-eslint/consistent-indexed-object-style */

/** Validated options of a placeholder. */
export interface Settings {
  readonly actions: UiActions;
  readonly texts: UiTexts;
  /** Title shown for a configured purpose: its own, or its id. */
  readonly title: (id: string) => string;
  /** Description of a configured purpose, if it has one. */
  readonly description: (id: string) => string | undefined;
}

/** Validated options of `mountUi`. */
export interface UiSettings extends Settings {
  readonly wouldReload: (choices: ConsentChoices) => boolean;
  readonly floatingButton: boolean;
}

const PLACEHOLDER_KEYS = ['actions', 'purposes', 'texts'] as const;
const UI_KEYS = [...PLACEHOLDER_KEYS, 'wouldReload', 'floatingButton'] as const;
const PURPOSE_KEYS = ['title', 'description'] as const;
const ACTION_KEYS = ['decide', 'grantAll', 'denyAll'] as const;
/** Groups of {@link UiTexts}; every one but `categories` has a fixed set of fields. */
const TEXT_GROUPS = [
  'banner',
  'preferences',
  'necessary',
  'button',
  'placeholder',
  'categories',
] as const;
const TEXT_KEYS = ['lang', ...TEXT_GROUPS] as const;

/**
 * Copies the own enumerable properties of `value` to a null-prototype object, so that a property
 * planted on a polluted prototype is never read.
 *
 * @throws {TypeError} `value` is neither `undefined` nor an object, with `message`.
 */
function copyOwn(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (value !== undefined && (typeof value !== 'object' || value === null)) {
    throw new TypeError(message);
  }
  return Object.assign(Object.create(null) as Record<string, unknown>, value);
}

/** @throws {TypeError} `own` has a key outside `keys`. */
function rejectUnknownKeys(own: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const unknown = Object.keys(own).find((key) => !keys.includes(key));
  if (unknown !== undefined) {
    throw new TypeError(`[lgpder] Unknown option: ${JSON.stringify(unknown)}.`);
  }
}

/**
 * `value` as quoted text for an error message: a primitive as `String` writes it, and an object or
 * a function as its type, so that no code of the application (`toString`) runs.
 */
function describeItem(value: unknown): string {
  const isObject = (typeof value === 'object' && value !== null) || typeof value === 'function';
  return JSON.stringify(isObject ? typeof value : String(value));
}

/**
 * A text shown in a component. An empty one would leave a button or a switch without an accessible
 * name.
 *
 * @throws {TypeError} `value` is not a non-empty string.
 */
function parseText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`[lgpder] "${name}" must be a non-empty string.`);
  }
  return value;
}

/** `value` parsed as a text, or `fallback` when it is `undefined`. */
function optionalText<T>(value: unknown, name: string, fallback: T): string | T {
  return value === undefined ? fallback : parseText(value, name);
}

/**
 * The texts of `value` merged over {@link ptBR}: `lang` replaced, each group field by field and
 * `categories` key by key. A field given as `undefined` keeps the built-in text.
 *
 * @throws {TypeError} Unknown group or field, or a text that is not a non-empty string.
 */
function parseTexts(value: unknown): UiTexts {
  if (value === undefined) return ptBR;
  const own = copyOwn(value, '[lgpder] "texts" must be an object.');
  rejectUnknownKeys(own, TEXT_KEYS);
  const texts: Record<string, unknown> = {
    lang: optionalText(own['lang'], 'texts.lang', ptBR.lang),
  };
  for (const group of TEXT_GROUPS) {
    const base: Readonly<Record<string, string>> = ptBR[group];
    const merged = Object.assign(Object.create(null) as Record<string, string>, base);
    const fields = copyOwn(own[group], `[lgpder] "texts.${group}" must be an object.`);
    if (group !== 'categories') rejectUnknownKeys(fields, Object.keys(base));
    for (const [field, text] of Object.entries(fields)) {
      if (text !== undefined) merged[field] = parseText(text, `texts.${group}.${field}`);
    }
    texts[group] = Object.freeze(merged);
  }
  return Object.freeze(texts) as unknown as UiTexts;
}

/**
 * The texts given for each purpose.
 *
 * @throws {RangeError} A purpose is not configured.
 * @throws {TypeError} Invalid texts of a purpose.
 */
function parsePurposeTexts(
  consent: ConsentManager,
  value: unknown,
): ReadonlyMap<string, UiPurposeTexts> {
  const texts = new Map<string, UiPurposeTexts>();
  for (const [id, fields] of Object.entries(
    copyOwn(value, '[lgpder] "purposes" must be an object.'),
  )) {
    if (!Object.hasOwn(consent.purposes, id)) {
      throw new RangeError(`[lgpder] Unknown purpose: ${JSON.stringify(id)}.`);
    }
    const own = copyOwn(fields, `[lgpder] The texts of ${JSON.stringify(id)} must be an object.`);
    rejectUnknownKeys(own, PURPOSE_KEYS);
    texts.set(id, {
      title: optionalText(own['title'], `purposes.${id}.title`, undefined),
      description: optionalText(own['description'], `purposes.${id}.description`, undefined),
    });
  }
  return texts;
}

/** @throws {TypeError} `value` is neither `undefined` nor an object with the three actions. */
function parseActions(consent: ConsentManager, value: unknown): UiActions {
  if (value === undefined) return consent;
  if (
    typeof value !== 'object' ||
    value === null ||
    ACTION_KEYS.some((key) => typeof (value as Record<string, unknown>)[key] !== 'function')
  ) {
    throw new TypeError('[lgpder] "actions" must have the functions decide, grantAll and denyAll.');
  }
  return value as UiActions;
}

/** Validates the options shared by the placeholder and the components. */
function parseShared(consent: ConsentManager, own: Readonly<Record<string, unknown>>): Settings {
  const actions = parseActions(consent, own['actions']);
  const purposes = parsePurposeTexts(consent, own['purposes']);
  return {
    actions,
    texts: parseTexts(own['texts']),
    title: (id) => purposes.get(id)?.title ?? id,
    description: (id) => purposes.get(id)?.description,
  };
}

/**
 * Validates the options of `createPlaceholder`, in the order of {@link PLACEHOLDER_KEYS}.
 *
 * @throws {TypeError} Invalid options.
 * @throws {RangeError} `purposes` has a purpose that is not configured.
 */
export function parsePlaceholderOptions(consent: ConsentManager, options: unknown): Settings {
  const own = copyOwn(options, '[lgpder] Options must be an object.');
  rejectUnknownKeys(own, PLACEHOLDER_KEYS);
  return parseShared(consent, own);
}

/**
 * Validates the options of `mountUi`, in the order of {@link UI_KEYS}.
 *
 * @throws {TypeError} Invalid options.
 * @throws {RangeError} `purposes` has a purpose that is not configured.
 */
export function parseUiOptions(consent: ConsentManager, options: unknown): UiSettings {
  const own = copyOwn(options, '[lgpder] Options must be an object.');
  rejectUnknownKeys(own, UI_KEYS);
  const shared = parseShared(consent, own);
  const { wouldReload = (): boolean => false, floatingButton = true } = own;
  if (typeof wouldReload !== 'function') {
    throw new TypeError('[lgpder] "wouldReload" must be a function.');
  }
  if (typeof floatingButton !== 'boolean') {
    throw new TypeError('[lgpder] "floatingButton" must be a boolean.');
  }
  return {
    ...shared,
    wouldReload: wouldReload as UiSettings['wouldReload'],
    floatingButton,
  };
}

/**
 * The purposes asked by `openPreferences`, in configuration order and without repetition;
 * `undefined` for every purpose.
 *
 * @throws {TypeError} `value` is neither `undefined` nor a non-empty array.
 * @throws {RangeError} An item is not a configured purpose.
 */
export function parsePurposeList(
  consent: ConsentManager,
  value: unknown,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('[lgpder] "purposes" must be a non-empty array.');
  }
  // Every index is visited and read only as an own property: a hole of a sparse array is refused,
  // never filled with a value planted on a polluted prototype.
  const asked = Array.from({ length: value.length }, (_, index) => {
    const id: unknown = Object.hasOwn(value, index) ? value[index] : undefined;
    if (typeof id !== 'string' || !Object.hasOwn(consent.purposes, id)) {
      throw new RangeError(`[lgpder] Unknown purpose: ${describeItem(id)}.`);
    }
    return id;
  });
  return Object.keys(consent.purposes).filter((id) => asked.includes(id));
}
