/**
 * Pages for the tests of the scripts layer: the body of the test document, and managers of the
 * default fixture connected to the scripts layer. Importing this module installs the DOM. Every page opened here must be closed with
 * {@link closePages} in `afterEach`, so that no subscription or listener outlives its test.
 */
import type { TestContext } from 'node:test';

import type { ConsentScripts, PlaceholderContext, ScriptsOptions } from 'lgpder/scripts';

import { connectScripts } from '../../src/scripts/index.ts';
import { testDom } from './dom.ts';
import { setup, type FixtureSetupOptions, type PurposeId, type Setup } from './setup.ts';

/** Manager of the default fixture, its recorder and its scripts layer. */
export interface Page extends Setup<PurposeId> {
  readonly scripts: ConsentScripts<PurposeId>;
}

const opened: ConsentScripts<PurposeId>[] = [];

/** Replaces the body of the test document with `html`. */
export function render(html: string): void {
  document.body.innerHTML = html;
}

/** The first element that matches `selector`; fails the test when there is none. */
export function find(selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`No element matches ${selector}.`);
  return element;
}

/** Every element that matches `selector`, in document order. */
export function findAll(selector: string): Element[] {
  return [...document.querySelectorAll(selector)];
}

/**
 * Creates the manager of the default fixture, subscribes the recorder and then connects the
 * scripts layer, with `options`, to the page already rendered.
 */
export function openPage(options?: ScriptsOptions<PurposeId>, fixture?: FixtureSetupOptions): Page {
  return connectPage(setup(fixture), options);
}

/** Connects the scripts layer, with `options`, to a manager already set up. */
export function connectPage(tab: Setup<PurposeId>, options?: ScriptsOptions<PurposeId>): Page {
  const scripts = connectScripts(tab.consent, options);
  opened.push(scripts);
  return { ...tab, scripts };
}

/** Destroys the scripts layer of every page opened since the last call. */
export function closePages(): void {
  for (const scripts of opened.splice(0)) scripts.destroy();
}

/** Placeholder renderer that records each context and returns a `<div class="placeholder">`. */
export interface RecordingRenderer {
  readonly render: (context: PlaceholderContext<PurposeId>) => Element;
  readonly contexts: PlaceholderContext<PurposeId>[];
}

export function recordingRenderer(): RecordingRenderer {
  const contexts: PlaceholderContext<PurposeId>[] = [];
  return {
    contexts,
    render: (context) => {
      contexts.push(context);
      const placeholder = document.createElement('div');
      placeholder.className = 'placeholder';
      return placeholder;
    },
  };
}

/** Waits for the microtasks already queued, such as the one that reloads the page. */
export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

/** Records every text assigned to `document.cookie` during `act`, without changing the effect. */
export function cookieWrites(act: () => void): string[] {
  const { Document } = testDom.window;
  const written: string[] = [];
  // The own property shadows the accessor of the prototype, which still does the real work.
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: (): unknown => Reflect.get(Document.prototype, 'cookie', document),
    set: (value: string) => {
      written.push(value);
      Reflect.set(Document.prototype, 'cookie', value, document);
    },
  });
  try {
    act();
  } finally {
    Reflect.deleteProperty(document, 'cookie');
  }
  return written;
}

/**
 * Makes `document.cookie` throw until the end of the test, as in an opaque origin (an iframe
 * sandboxed without `allow-same-origin`). Returns the error thrown.
 */
export function refuseCookies(t: TestContext): Error {
  const refusal = new testDom.window.DOMException('The operation is insecure.', 'SecurityError');
  const refuse = (): never => {
    throw refusal;
  };
  Object.defineProperty(document, 'cookie', { configurable: true, get: refuse, set: refuse });
  t.after(() => {
    Reflect.deleteProperty(document, 'cookie');
  });
  return refusal;
}

/** Names of the cookies the page sees, in the order of `document.cookie`. */
export function cookieNames(): string[] {
  return document.cookie
    .split('; ')
    .filter(Boolean)
    .map((pair) => pair.slice(0, Math.max(pair.indexOf('='), 0)));
}
