// One loader hook for data reads. Fail closed: the state is "loading", "error" (with the message the
// UI must show) or "ok" with data. There is no state in which an error looks like an empty result.
// A response that arrives after its inputs changed (for example after switching entity) is dropped.
import { useCallback, useEffect, useRef, useState } from 'react';
import { userMessage } from './errors';

export type Load<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: T };

export function useLoad<T>(fn: () => Promise<T>, deps: readonly unknown[]): Load<T> & { reload: () => void } {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const run = useRef(0);
  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    const mine = ++run.current;
    setState({ status: 'loading' });
    fn().then(
      data => { if (run.current === mine) setState({ status: 'ok', data }); },
      (err: unknown) => { if (run.current === mine) setState({ status: 'error', message: userMessage(err) }); },
    );
    // fn changes identity on every render; the caller's deps say when to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { ...state, reload };
}
