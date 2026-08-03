import { useEffect, useReducer } from 'react';
import { STORE_KEY, initialState, reducer, readStored } from './reducer';

// Re-exported so callers and tests can keep importing from one place.
export { STORE_KEY, initialState, reducer, readStored };
export type { Action } from './reducer';

export function useRummikub() {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => readStored() ?? init);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // Storage can be unavailable; the session still works.
    }
  }, [state]);

  return { state, dispatch };
}
