/**
 * Pages for the tests of the google layer: managers of the default fixture connected to the layer,
 * and readers of the commands sent to the Google tag. Importing this module installs the DOM. Every
 * layer connected here must be destroyed with {@link closeGoogles} in `afterEach`, so that no
 * subscription outlives its test.
 */
import type { ConsentGoogle, ConsentType, GoogleOptions } from 'lgpder/google';

import { connectGoogle } from '../../src/google/index.ts';
import { testDom } from './dom.ts';
import { setup, type FixtureSetupOptions, type PurposeId, type Setup } from './setup.ts';

/** Manager of the default fixture, its recorder and its google layer. */
export interface GooglePage extends Setup<PurposeId> {
  readonly google: ConsentGoogle;
}

/** A command sent to the Google tag, as an array: `['consent', 'update', params]`. */
export type Command = readonly unknown[];

/** Parameters of a consent command. */
export type ConsentParams = Readonly<Record<string, string | number>>;

/** Every consent type, in the order the layer sends them. */
export const CONSENT_TYPES: readonly ConsentType[] = [
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
  'analytics_storage',
  'functionality_storage',
  'personalization_storage',
  'security_storage',
];

/** The types of `granted` as `'granted'` and every other type as `'denied'`. */
export function consentWith(...granted: readonly ConsentType[]): ConsentParams {
  return Object.fromEntries(
    CONSENT_TYPES.map((type) => [type, granted.includes(type) ? 'granted' : 'denied']),
  );
}

/** Parameters of the consent default: every type denied, with the wait for the first update. */
export const DEFAULT_PARAMS: ConsentParams = { ...consentWith(), wait_for_update: 500 };

/** The default command, as the snippet and the layer send it. */
export const DEFAULT_COMMAND: Command = ['consent', 'default', DEFAULT_PARAMS];

const opened: ConsentGoogle[] = [];

/**
 * Creates the manager of the default fixture, subscribes the recorder and then connects the google
 * layer with `options`.
 */
export function openGoogle(
  options: GoogleOptions<PurposeId>,
  fixture?: FixtureSetupOptions,
): GooglePage {
  return connectGoogleTo(setup(fixture), options);
}

/** Connects the google layer, with `options`, to a manager already set up. */
export function connectGoogleTo(
  tab: Setup<PurposeId>,
  options: GoogleOptions<PurposeId>,
): GooglePage {
  const google = connectGoogle(tab.consent, options);
  opened.push(google);
  return { ...tab, google };
}

/** Destroys the google layer of every page opened since the last call. */
export function closeGoogles(): void {
  for (const google of opened.splice(0)) google.destroy();
}

/** `window.dataLayer` of the page, as it is; `undefined` when there is none. */
export function dataLayer(): unknown {
  return Reflect.get(testDom.window, 'dataLayer');
}

/** Replaces `window.dataLayer` of the page. */
export function setDataLayer(value: unknown): void {
  Reflect.set(testDom.window, 'dataLayer', value);
}

/** Whether `value` is an `arguments` object, of any realm. */
export function isArguments(value: unknown): boolean {
  return Object.prototype.toString.call(value) === '[object Arguments]';
}

/**
 * An entry of any realm, such as one queued by the snippet run in the page, as a plain array of
 * this realm, so that `deepStrictEqual` compares the values and not the prototypes. An entry that
 * is not a command becomes an array without its values.
 */
function asCommand(entry: unknown): Command {
  return JSON.parse(JSON.stringify(Array.from(Object(entry) as ArrayLike<unknown>))) as Command;
}

/** Every entry of the dataLayer, each as a plain array; `[]` when there is no dataLayer. */
export function queued(): Command[] {
  const entries = dataLayer();
  return Array.isArray(entries) ? Array.from(entries, asCommand) : [];
}

/** Parameters of every consent update in `commands`, in order. */
export function updatesIn(commands: readonly Command[]): ConsentParams[] {
  return commands
    .filter(([command, action]) => command === 'consent' && action === 'update')
    .map(([, , params]) => params as ConsentParams);
}

/** Parameters of every consent update queued in the dataLayer, in order. */
export function updates(): ConsentParams[] {
  return updatesIn(queued());
}

/** Parameters of the last consent update queued in the dataLayer. */
export function lastUpdate(): ConsentParams | undefined {
  return updates().at(-1);
}

/**
 * Defines `window.gtag` as a function that records each call, as a plain array, without touching
 * the dataLayer. Returns the recorded calls.
 */
export function installGtag(): Command[] {
  const calls: Command[] = [];
  Reflect.set(testDom.window, 'gtag', (...args: unknown[]) => {
    calls.push(asCommand(args));
  });
  return calls;
}
