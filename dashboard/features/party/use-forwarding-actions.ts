'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Event-only forwarding: stable function identities that always call the latest
 * committed action closure. `usePartyConsole()` rebuilds its plain action
 * functions (and small state-setter wrappers) on every render; passing those
 * directly into a memoized child defeats the memoization since the prop
 * identity always differs. This returns wrappers that never change identity,
 * so a `memo()`ed consumer only re-renders when the data it actually reads
 * (passed separately) changes.
 */
export function useForwardingActions<M extends object, K extends keyof M>(
  model: M,
  keys: readonly K[],
): Pick<M, K> {
  const latest = useRef(model);
  useLayoutEffect(() => {
    latest.current = model;
  }, [model]);
  const getModel = useCallback(() => latest.current, []);
  // The factory only creates event handlers; it never invokes getModel during
  // render. The compiler cannot infer that through Reflect.apply.
  // eslint-disable-next-line react/react-compiler
  const [actions] = useState(
    () =>
      Object.fromEntries(
        keys.map((key) => [
          key,
          (...args: unknown[]) =>
            Reflect.apply(
              getModel()[key] as unknown as (...args: unknown[]) => unknown,
              undefined,
              args,
            ),
        ]),
      ) as Pick<M, K>,
  );
  return actions;
}
