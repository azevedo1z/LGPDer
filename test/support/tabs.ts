/**
 * Tabs of one browser for the tests of the storage layer: managers of the default fixture, each
 * connected to a storage. Every tab opened here must be closed with {@link closeTabs} in
 * `afterEach`, so that no listener or `BroadcastChannel` outlives its test.
 */
import { once } from 'node:events';

import type { ConsentStorage, StorageOptions } from 'lgpder/storage';

import { connectStorage } from '../../src/storage/index.ts';
import { setup, type FixtureSetupOptions, type PurposeId, type Setup } from './setup.ts';

/** Manager of the default fixture, its recorder and its storage connection. */
export interface Tab extends Setup<PurposeId> {
  readonly storage: ConsentStorage<PurposeId>;
}

const opened: ConsentStorage[] = [];

/**
 * Creates the manager of the default fixture, subscribes the recorder and then connects the
 * storage with `options`.
 */
export function openTab(options?: StorageOptions, fixture?: FixtureSetupOptions): Tab {
  return connectTab(setup(fixture), options);
}

/**
 * Connects the storage, with `options`, to a manager already set up, after the listeners the test
 * subscribed to it.
 */
export function connectTab(tab: Setup<PurposeId>, options?: StorageOptions): Tab {
  const storage = connectStorage(tab.consent, options);
  opened.push(storage);
  return { ...tab, storage };
}

/** Destroys the storage of every tab opened since the last call. */
export function closeTabs(): void {
  for (const storage of opened.splice(0)) storage.destroy();
}

/**
 * Waits for the next message posted on the `BroadcastChannel` named `name`, and then for the
 * channels of the tabs to handle it.
 */
export async function nextBroadcast(name = 'lgpder:lgpder'): Promise<void> {
  const probe = new BroadcastChannel(name);
  try {
    await once(probe, 'message');
  } finally {
    probe.close();
  }
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}
