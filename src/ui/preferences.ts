/**
 * The preferences center: a modal dialog with one switch per purpose, grouped by category, that
 * keeps the focus inside while open.
 */

import type { ConsentManager } from '../index.ts';
import { button, h } from './dom.ts';
import { createHost, PREFERENCES, type Host } from './elements.ts';
import type { Settings } from './options.ts';

/** What the controls of the center do. */
export interface PreferencesHandlers {
  readonly toggle: (id: string) => void;
  readonly save: () => void;
  readonly close: () => void;
}

/** The preferences center, whose content exists only while it is open. */
export interface PreferencesView {
  readonly host: Host;
  /**
   * Builds the content for `ids`, in configuration order, with the section of the necessary
   * cookies only when `full`, and keeps the keyboard and the focus in the center while it is
   * shown, until {@link PreferencesView.clear}.
   */
  readonly build: (ids: readonly string[], full: boolean) => void;
  /** Sets each switch from `isOn`, and the label of the save button from `reload`. */
  readonly update: (isOn: (id: string) => boolean, reload: boolean) => void;
  /** Removes the content and stops keeping the keyboard and the focus. */
  readonly clear: () => void;
  readonly focusFirst: () => void;
}

/** Purposes of one category, under a title; without title, a flat list. */
interface Group {
  readonly title: string | undefined;
  readonly ids: readonly string[];
}

/**
 * The purposes grouped by category, in order of first appearance, with the ones without category
 * in a final group. When none has a category, a single group without title.
 */
function groupByCategory(
  purposes: ConsentManager['purposes'],
  ids: readonly string[],
  { texts }: Settings,
): Group[] {
  const byCategory = new Map<string | undefined, string[]>();
  for (const id of ids) {
    const category = purposes[id]?.category;
    const group = byCategory.get(category);
    if (group === undefined) byCategory.set(category, [id]);
    else group.push(id);
  }
  const others = byCategory.get(undefined);
  if (others !== undefined && byCategory.size === 1) return [{ title: undefined, ids: others }];
  const groups: Group[] = [];
  for (const [category, members] of byCategory) {
    if (category !== undefined) {
      groups.push({ title: texts.categories[category] ?? category, ids: members });
    }
  }
  if (others !== undefined) groups.push({ title: texts.preferences.otherPurposes, ids: others });
  return groups;
}

/** A titled section of the center, labelled by its heading. */
function section(part: string, id: string, title: string, ...content: readonly Node[]): Element {
  return h(
    'section',
    { part, 'aria-labelledby': id },
    h('h3', { part: `${part}-title`, id }, title),
    ...content,
  );
}

/** Creates the preferences center, hidden and empty. */
export function createPreferences(
  purposes: ConsentManager['purposes'],
  settings: Settings,
  handlers: PreferencesHandlers,
): PreferencesView {
  const { texts, title, description } = settings;
  const { preferences } = texts;
  const host = createHost(PREFERENCES, texts.lang);
  const { shadowRoot } = host;
  const dialog = h('div', {
    part: 'dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'title',
    'aria-describedby': 'description',
  });
  shadowRoot.append(h('div', { part: 'backdrop' }, dialog));
  const switches = new Map<string, HTMLButtonElement>();
  const save = button('button primary', preferences.save, handlers.save);

  const focusFirst = (): void => {
    dialog.querySelector('button')?.focus();
  };

  // Listened on the document while the center has content, so they also run when the focus left
  // the controls (a click on the text of the dialog or on the backdrop moves it to the body). The
  // center is shown whenever it has content on the page; it may have content before being on the
  // page, while the document loads. Esc closes; Tab and Shift+Tab wrap around the controls, which
  // are all buttons.
  const onKeydown = (event: KeyboardEvent): void => {
    if (!host.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      handlers.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = dialog.querySelectorAll('button');
    const first = controls[0];
    const last = controls[controls.length - 1];
    const active = shadowRoot.activeElement;
    const edge = event.shiftKey ? first : last;
    if (active === edge || !dialog.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  };
  // The focus moved to the page behind, by a script of the page: back to the first control. From
  // the document, a focus inside the shadow root has the host as target.
  const onFocusIn = (event: FocusEvent): void => {
    if (host.isConnected && event.target !== host) focusFirst();
  };

  /** A purpose, with its switch labelled by its title and described by the rest. */
  const purpose = (id: string, index: number): Element => {
    const n = String(index);
    const individual = purposes[id]?.individualGrant === true;
    const text = description(id);
    const describedBy = [individual ? `badge-${n}` : '', text === undefined ? '' : `about-${n}`];
    const toggle = button(
      'switch',
      '',
      () => {
        handlers.toggle(id);
      },
      {
        role: 'switch',
        'aria-checked': 'false',
        'aria-labelledby': `purpose-${n}`,
        'aria-describedby': describedBy.join(' ').trim() || undefined,
      },
    );
    switches.set(id, toggle);
    return h(
      'div',
      { part: individual ? 'purpose individual' : 'purpose' },
      h(
        'div',
        {},
        h('span', { part: 'purpose-title', id: `purpose-${n}` }, title(id)),
        individual && h('span', { part: 'badge', id: `badge-${n}` }, preferences.individualGrant),
        text !== undefined && h('p', { part: 'purpose-description', id: `about-${n}` }, text),
      ),
      toggle,
    );
  };

  return {
    host,
    build: (ids, full) => {
      switches.clear();
      let index = 0;
      const next = (id: string): Element => purpose(id, index++);
      const groups = groupByCategory(purposes, ids, settings).map(
        ({ title: heading, ids: members }, g) =>
          heading === undefined
            ? members.map(next)
            : [section('category', `category-${String(g)}`, heading, ...members.map(next))],
      );
      document.addEventListener('keydown', onKeydown, true);
      document.addEventListener('focusin', onFocusIn);
      dialog.replaceChildren(
        h('h2', { part: 'title', id: 'title' }, preferences.title),
        h('p', { part: 'description', id: 'description' }, preferences.description),
        ...(full
          ? [
              section(
                'necessary',
                'necessary',
                texts.necessary.title,
                h('p', { part: 'description' }, texts.necessary.description),
              ),
            ]
          : []),
        ...groups.flat(),
        h(
          'div',
          { part: 'footer' },
          button('button close', preferences.close, handlers.close),
          save,
        ),
      );
    },
    update: (isOn, reload) => {
      for (const [id, toggle] of switches) toggle.setAttribute('aria-checked', String(isOn(id)));
      save.textContent = reload ? preferences.saveAndReload : preferences.save;
    },
    clear: () => {
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('focusin', onFocusIn);
      switches.clear();
      dialog.replaceChildren();
    },
    focusFirst,
  };
}
