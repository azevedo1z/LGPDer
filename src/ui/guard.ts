/** The guarded call of application code: the actions, `wouldReload` and "Permitir sempre". */

/**
 * Calls a function that may throw, such as one of the application. An exception is rethrown in a
 * microtask, as the manager does with its listeners, so the layer goes on and the error stays
 * visible.
 *
 * @returns The result of `fn`, or `undefined` when it throws.
 */
export function callGuarded<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
    return undefined;
  }
}
