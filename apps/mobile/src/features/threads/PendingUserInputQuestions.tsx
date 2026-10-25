import type { RuntimeRequestId } from "@t3tools/contracts";
import type { ThreadUserInputQuestion } from "@t3tools/client-runtime/state/thread-requests";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import {
  isPendingUserInputOptionSelected,
  type PendingUserInput,
  type PendingUserInputDraftAnswer,
} from "../../lib/threadActivity";
import { QuestionAttachments } from "./QuestionAttachments";

export interface PendingUserInputQuestionsProps {
  readonly pendingUserInput: PendingUserInput;
  /** False once the provider process is gone: the questions read but cannot be answered. */
  readonly canRespond: boolean;
  readonly drafts: Record<string, PendingUserInputDraftAnswer>;
  readonly respondingUserInputId: RuntimeRequestId | null;
  readonly onSelectOption: (
    requestId: RuntimeRequestId,
    question: ThreadUserInputQuestion,
    value: string,
  ) => void;
  readonly onChangeCustomAnswer: (
    requestId: RuntimeRequestId,
    questionId: string,
    customAnswer: string,
  ) => void;
  /** Fires on custom-answer focus/blur; hosts use it to vet stale keyboard state. */
  readonly onInputFocusChange?: (focused: boolean) => void;
  /**
   * Reading mode for the full-screen presentation: same content, larger type
   * and taller targets, sized for an unfolded foldable or a tablet.
   */
  readonly roomy?: boolean;
}

/**
 * The questionnaire body of the full-screen presentation. Its compact (non-roomy) form matches
 * the inline body upstream's PendingUserInputCard renders, which stays inline there to keep that
 * file close to upstream. Answers live in the host's drafts, so the card and the full screen stay
 * in sync while both are mounted.
 */
export function PendingUserInputQuestions(props: PendingUserInputQuestionsProps) {
  const roomy = props.roomy === true;
  const responseDisabled =
    !props.canRespond || props.respondingUserInputId === props.pendingUserInput.requestId;
  return (
    <>
      {!props.canRespond ? (
        <Text
          className={cn(
            "font-sans text-adaptive-neutral-600-400",
            roomy ? "text-base leading-6" : "text-sm leading-5",
          )}
        >
          The provider process for this request is no longer available. Interrupt or restart the run
          to continue.
        </Text>
      ) : null}
      {props.pendingUserInput.questions.map((question) => {
        const draft = props.drafts[question.id];
        return (
          <View key={question.id} className={cn("gap-2", roomy ? "pt-3" : "pt-1")}>
            <Text
              className={cn(
                "font-t3-bold uppercase tracking-[1px] text-foreground-muted",
                roomy ? "text-sm" : "text-xs",
              )}
            >
              {question.header}
            </Text>
            <Text
              className={cn(
                "font-sans leading-snug text-foreground",
                roomy ? "text-xl" : "text-base",
              )}
            >
              {question.question}
            </Text>
            <View className="gap-2">
              {question.options.map((option) => {
                const optionValue = option.value ?? option.label.trim();
                const selected = isPendingUserInputOptionSelected(question, draft, optionValue);
                const description =
                  option.description !== option.label ? option.description : undefined;
                return (
                  <Pressable
                    key={optionValue}
                    accessibilityRole={question.multiSelect ? "checkbox" : "radio"}
                    accessibilityState={{ checked: selected, disabled: responseDisabled }}
                    disabled={responseDisabled}
                    className={cn(
                      "w-full rounded-2xl border",
                      roomy ? "min-h-14 px-4 py-4" : "min-h-12 px-3.5 py-3",
                      selected ? "border-primary bg-primary/10" : "border-border bg-input",
                    )}
                    onPress={() =>
                      props.onSelectOption(props.pendingUserInput.requestId, question, optionValue)
                    }
                  >
                    <View className="min-w-0 flex-1 gap-0.5">
                      <Text
                        className={cn(
                          "font-t3-bold",
                          roomy ? "text-base" : "text-sm",
                          selected ? "text-foreground" : "text-foreground-secondary",
                        )}
                      >
                        {option.label}
                      </Text>
                      {description ? (
                        <Text
                          className={cn(
                            "font-sans text-foreground-muted",
                            roomy ? "text-base leading-6" : "text-sm leading-5",
                          )}
                        >
                          {description}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {question.allowCustomAnswer !== false ? (
              <QuestionAttachments
                requestId={props.pendingUserInput.requestId}
                question={question}
                questions={props.pendingUserInput.questions}
                disabled={responseDisabled}
                value={draft?.customAnswer ?? ""}
                onChangeText={(value) =>
                  props.onChangeCustomAnswer(props.pendingUserInput.requestId, question.id, value)
                }
                onInputFocusChange={props.onInputFocusChange}
              />
            ) : null}
          </View>
        );
      })}
    </>
  );
}
