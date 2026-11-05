/**
 * Builders of the content of the components, and focus helpers. Every text is inserted as a text
 * node, never parsed as HTML, so a text of the application cannot inject markup.
 */

/** Attributes of an element; `undefined` leaves the attribute out. */
type Attributes = Readonly<Record<string, string | undefined>>;

/** Child of an element: a node, a text, or nothing (`false` and `undefined` are skipped). */
type Child = Node | string | false | undefined;

/** Creates an element with `attributes` and `children`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes,
  ...children: readonly Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) element.setAttribute(name, value);
  }
  for (const child of children) if (child !== false && child !== undefined) element.append(child);
  return element;
}

/** Creates a `<button type="button">` with `part`, labelled by `label`, that calls `onClick`. */
export function button(
  part: string,
  label: string,
  onClick: () => void,
  attributes: Attributes = {},
): HTMLButtonElement {
  const element = h('button', { type: 'button', part, ...attributes }, label);
  element.addEventListener('click', onClick);
  return element;
}

/** The focused element, looked up through the open shadow roots. */
export function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Whether `element` can take the focus by script. */
export function isFocusable(element: Element | null): element is HTMLElement {
  return typeof (element as Partial<HTMLElement> | null)?.focus === 'function';
}
