/**
 * The elements blocked by `data-consent` and the changes the layer makes to them in the document:
 * activating a script, loading and blocking an iframe or image, and showing its placeholder.
 */

/** Mark of every element activated by the layer, read by later instances on the same page. */
export const ACTIVE = 'data-consent-active';

/** Elements blocked by the author, in document order. */
const BLOCKED = 'script[type="text/plain"][data-consent],iframe[data-consent],img[data-consent]';

/** Scripts activated on this page, by this instance or by an earlier one. */
const ACTIVATED = `script[data-consent][${ACTIVE}]`;

/** Scripts marked by the author that the browser runs anyway, since they are not text/plain. */
const UNBLOCKED = `script[data-consent]:not([type="text/plain"]):not([${ACTIVE}])`;

/** Fields shared by every handled element. */
interface BaseEntry {
  /** Node currently in the document: the element of the author or the node that replaced it. */
  node: Element;
  /** Purposes of its `data-consent`, in attribute order, without repetition. Frozen. */
  readonly purposes: readonly string[];
  /** Whether `data-consent` names at least one purpose and only configured ones. */
  readonly valid: boolean;
  /** Whether the script was activated or the content is loaded. */
  active: boolean;
}

/** A `<script type="text/plain">`, activated once at most. */
export interface ScriptEntry extends BaseEntry {
  readonly kind: 'script';
}

/** An iframe or image, loaded on a grant and blocked again on a revocation. */
export interface EmbedEntry extends BaseEntry {
  readonly kind: 'embed';
  /** Copy of the element without `src`, `srcset` and the active mark, kept to block it again. */
  readonly blocked: Element;
  /** Whether it was loaded by its placeholder, without consent. */
  loaded: boolean;
  /** Placeholder shown before the blocked iframe. */
  placeholder: Element | undefined;
  /** Whether the renderer was already called for the current block, whatever it did. */
  rendered: boolean;
}

export type Entry = ScriptEntry | EmbedEntry;

/**
 * The purposes of the `data-consent` of `element`, in attribute order, without repetition. Frozen,
 * since the placeholder context hands the same list to the application.
 */
export function purposesOf(element: Element): readonly string[] {
  const tokens = (element.getAttribute('data-consent') ?? '').split(/\s+/).filter(Boolean);
  return Object.freeze([...new Set(tokens)]);
}

/** Blocked elements under `root`, in document order. */
export function findBlocked(root: ParentNode): NodeListOf<Element> {
  return root.querySelectorAll(BLOCKED);
}

/** Scripts under `root` with data-consent that run without consent, in document order. */
export function findUnblocked(root: ParentNode): NodeListOf<HTMLScriptElement> {
  return root.querySelectorAll<HTMLScriptElement>(UNBLOCKED);
}

/** Purposes of every script activated on this page. */
export function activatedPurposes(): string[] {
  return [...document.querySelectorAll(ACTIVATED)].flatMap(purposesOf);
}

/**
 * State of a blocked element found by a scan. An iframe or image that already has `src`, `srcset`
 * or the active mark is taken as loaded, and marked: the reconciliation blocks it unless every
 * purpose is granted.
 *
 * @param isPurpose - Whether a token is a configured purpose.
 */
export function createEntry(element: Element, isPurpose: (id: string) => boolean): Entry {
  const purposes = purposesOf(element);
  const valid = purposes.length > 0 && purposes.every(isPurpose);
  if (element.localName === 'script') {
    return { kind: 'script', node: element, purposes, valid, active: false };
  }
  const blocked = element.cloneNode(true) as Element;
  for (const name of ['src', 'srcset', ACTIVE]) blocked.removeAttribute(name);
  const active = ['src', 'srcset', ACTIVE].some((name) => element.hasAttribute(name));
  if (active) element.setAttribute(ACTIVE, '');
  return {
    kind: 'embed',
    node: element,
    purposes,
    valid,
    active,
    blocked,
    loaded: false,
    placeholder: undefined,
    rendered: false,
  };
}

/** Attributes of a blocked script that the real one does not take. */
const NOT_COPIED = new Set(['type', 'data-src', 'async']);

/**
 * Replaces the blocked script with a real one: every attribute except `type`, `data-src` and
 * `async`, the `nonce` property (the browser hides the attribute), `src` from `data-src` or else
 * the inline content, and `async = false`, which keeps external scripts in document order.
 */
export function activateScript(entry: ScriptEntry): void {
  const original = entry.node as HTMLScriptElement;
  const script = document.createElement('script');
  for (const { name, value } of original.attributes) {
    if (!NOT_COPIED.has(name)) script.setAttribute(name, value);
  }
  script.setAttribute(ACTIVE, '');
  if (original.nonce !== '') script.nonce = original.nonce;
  const src = original.getAttribute('data-src');
  if (src === null) script.textContent = original.textContent;
  else script.src = src;
  script.async = false;
  entry.node = script;
  entry.active = true;
  original.replaceWith(script);
}

/** Loads the iframe or image from its `data-src` and removes its placeholder. */
export function loadEmbed(entry: EmbedEntry): void {
  removePlaceholder(entry);
  const src = entry.node.getAttribute('data-src');
  if (src !== null) entry.node.setAttribute('src', src);
  entry.node.setAttribute(ACTIVE, '');
  entry.active = true;
}

/**
 * Replaces the loaded iframe or image with a copy of its blocked state, since removing `src` does
 * not unload the content in every browser.
 *
 * @returns The node now in the document.
 */
export function blockEmbed(entry: EmbedEntry): Element {
  const blocked = entry.blocked.cloneNode(true) as Element;
  entry.node.replaceWith(blocked);
  entry.node = blocked;
  entry.active = false;
  entry.loaded = false;
  entry.rendered = false;
  return blocked;
}

/** Shows `placeholder` before the blocked iframe, which is hidden meanwhile. */
export function showPlaceholder(entry: EmbedEntry, placeholder: Element): void {
  entry.node.before(placeholder);
  entry.node.setAttribute('hidden', '');
  entry.placeholder = placeholder;
}

/** Removes the placeholder, if any, and gives the iframe back the `hidden` set by its author. */
export function removePlaceholder(entry: EmbedEntry): void {
  if (entry.placeholder === undefined) return;
  entry.placeholder.remove();
  entry.placeholder = undefined;
  const hidden = entry.blocked.getAttribute('hidden');
  if (hidden === null) entry.node.removeAttribute('hidden');
  else entry.node.setAttribute('hidden', hidden);
}
