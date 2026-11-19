import { voiceInputBlocksSubmission } from "@t3tools/client-runtime/voice-input";
import type { VoiceInputSnapshot } from "../voice-input/voiceInputSession";

type Session = {
  readonly getSnapshot: () => Pick<VoiceInputSnapshot, "ownerKey" | "state" | "focusedOwners">;
  readonly subscribe: (listener: () => void) => () => void;
  readonly controller: { readonly cancel: () => unknown };
};

export function createControllerDictationOwnership() {
  let owned: {
    scope: string;
    surfaceId: string | undefined;
    session: Session;
    ownerKey: string;
    unsubscribe: () => void;
  } | null = null;
  const release = () => {
    const previous = owned;
    owned = null;
    previous?.unsubscribe();
  };
  return {
    owns(scope: string, surfaceId?: string) {
      if (owned?.scope !== scope || (surfaceId !== undefined && owned.surfaceId !== surfaceId))
        return false;
      const current = owned.session.getSnapshot();
      return current.ownerKey === owned.ownerKey && voiceInputBlocksSubmission(current.state);
    },
    start(scope: string, session: Session, start: () => unknown, surfaceId?: string) {
      if (voiceInputBlocksSubmission(session.getSnapshot().state)) return;
      start();
      const snapshot = session.getSnapshot();
      if (!snapshot.ownerKey || !voiceInputBlocksSubmission(snapshot.state)) return;
      release();
      const ownerKey = snapshot.ownerKey;
      const unsubscribe = session.subscribe(() => {
        const current = session.getSnapshot();
        if (current.ownerKey !== ownerKey || !voiceInputBlocksSubmission(current.state)) release();
        else if (!current.focusedOwners.has(ownerKey)) {
          release();
          session.controller.cancel();
        }
      });
      owned = { scope, surfaceId, session, ownerKey, unsubscribe };
    },
    cancel(scope: string) {
      if (owned?.scope !== scope) return;
      const captured = owned;
      release();
      const current = captured.session.getSnapshot();
      if (current.ownerKey === captured.ownerKey && voiceInputBlocksSubmission(current.state))
        captured.session.controller.cancel();
    },
  };
}
export const controllerDictation = createControllerDictationOwnership();
