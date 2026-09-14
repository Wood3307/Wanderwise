import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

interface JourneyExitGuardOptions {
  /** The current trip has visits that the user has not exported or discarded. */
  dirty: boolean;
  /** Open the in-app export choice after the user cancels the native exit prompt. */
  onCloseAttempt: () => void;
}

/**
 * Browsers own the beforeunload wording and its Leave/Cancel buttons. A Leave
 * choice is never consent to export. The deferred callback can only offer the
 * app's export choice while this document is still alive; it performs no export.
 */
export function useJourneyExitGuard({ dirty, onCloseAttempt }: JourneyExitGuardOptions) {
  const latest = useRef({ dirty, onCloseAttempt });
  const bypass = useRef(false);
  const pending = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    latest.current = { dirty, onCloseAttempt };
  }, [dirty, onCloseAttempt]);

  const cancelPending = useCallback(() => {
    if (pending.current !== undefined) window.clearTimeout(pending.current);
    pending.current = undefined;
  }, []);

  const allowLeave = useCallback(() => {
    // Navigation may occur in this same handler, before React commits clean state.
    bypass.current = true;
    cancelPending();
  }, [cancelPending]);

  const rearm = useCallback(() => {
    bypass.current = false;
    cancelPending();
  }, [cancelPending]);

  useEffect(() => {
    // A clean trip followed by new visits constitutes a new protected journey.
    if (!dirty) {
      bypass.current = false;
      cancelPending();
      return;
    }

    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current || !latest.current.dirty) return;
      event.preventDefault();
      event.returnValue = true;
      cancelPending();
      // The native dialog blocks JS. On cancellation this resumes in the same
      // document. On accepted navigation the old document is disposed; even if
      // a browser runs this first, the callback merely opens UI, never exports.
      pending.current = window.setTimeout(() => {
        pending.current = undefined;
        if (!bypass.current && latest.current.dirty) latest.current.onCloseAttempt();
      }, 0);
    };

    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      cancelPending();
    };
  }, [dirty, cancelPending]);

  return { allowLeave, rearm };
}
