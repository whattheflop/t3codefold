import { useNavigation } from "@react-navigation/native";
import { ComposerContextId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";
import { Alert } from "react-native";

import { uuidv4 } from "../../lib/uuid";
import { insertComposerDraftContext } from "../../state/use-composer-drafts";
import { sourceSelectionContext } from "./source-selection";

/**
 * Attaches a native source-line selection to the thread's composer draft and opens the thread.
 * Undefined when the file is not shown for a thread, so the surface hides the action.
 */
export function useAttachSourceSelection(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly contents: string | null;
  readonly path: string;
}) {
  const navigation = useNavigation();
  const { environmentId, threadId, contents, path } = input;
  const attachSelectedLines = useCallback(
    (selection: { readonly startIndex: number; readonly endIndex: number }) => {
      if (threadId === null || contents === null) return;
      const context = sourceSelectionContext({
        ...selection,
        contents,
        path,
        contextId: ComposerContextId.make(uuidv4()),
      });
      if (!context) return;
      if (insertComposerDraftContext(`${environmentId}:${threadId}`, context)) {
        navigation.navigate("Thread", {
          environmentId: String(environmentId),
          threadId: String(threadId),
        });
      } else {
        Alert.alert("Too many context items", "Remove some context from the draft and try again.");
      }
    },
    [navigation, environmentId, threadId, contents, path],
  );
  return threadId === null ? undefined : attachSelectedLines;
}
