import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { derivePendingUserInputFullScreenLayout } from "./pendingUserInputFullScreenLayout";
import {
  PendingUserInputQuestions,
  type PendingUserInputQuestionsProps,
} from "./PendingUserInputQuestions";
import { Button } from "../../components/ui/Button";

export interface PendingUserInputFullScreenProps extends Omit<
  PendingUserInputQuestionsProps,
  "roomy"
> {
  readonly visible: boolean;
  readonly answers: Record<string, string | ReadonlyArray<string>> | null;
  readonly onRequestClose: () => void;
  readonly onSubmit: () => Promise<unknown>;
  readonly onDismiss: () => Promise<unknown>;
}

/**
 * The questionnaire on its own screen, for requests too long to read in the
 * card that replaces the composer. Opt-in: the card stays the default, and
 * closing returns to it with every draft answer intact, because both
 * presentations read and write the host's drafts.
 */
export function PendingUserInputFullScreen(props: PendingUserInputFullScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const layout = derivePendingUserInputFullScreenLayout({ windowWidth: width });
  const questionCount = props.pendingUserInput.questions.length;
  const responding = props.respondingUserInputId === props.pendingUserInput.requestId;
  const close = props.onRequestClose;
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={close}
    >
      {/* The modal is its own window: the app-root keyboard controller does
          not reach it, so this uses the platform view. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1 bg-screen"
      >
        <View
          className="flex-1"
          style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <View
            className="w-full self-center flex-row items-start gap-3 pb-3 pt-2"
            style={{ maxWidth: layout.contentMaxWidth + layout.horizontalPadding * 2 }}
          >
            <View className="flex-1 gap-1" style={{ paddingLeft: layout.horizontalPadding }}>
              <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
                User input needed
              </Text>
              <Text className="font-t3-bold text-2xl text-foreground">
                {questionCount} question{questionCount === 1 ? "" : "s"}
              </Text>
            </View>
            <View style={{ paddingRight: layout.horizontalPadding }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close full screen user input"
                onPress={close}
                className="h-11 w-11 items-center justify-center rounded-full bg-subtle-strong active:opacity-70"
              >
                <SymbolView
                  name="arrow.down.right.and.arrow.up.left"
                  size={18}
                  tintColorClassName={"accent-icon-subtle"}
                  type="monochrome"
                />
              </Pressable>
            </View>
          </View>
          <ScrollView
            className="min-h-0 flex-1"
            contentContainerStyle={{
              paddingHorizontal: layout.horizontalPadding,
              paddingBottom: 24,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <View className="w-full self-center gap-3" style={{ maxWidth: layout.contentMaxWidth }}>
              <PendingUserInputQuestions
                roomy
                pendingUserInput={props.pendingUserInput}
                canRespond={props.canRespond}
                drafts={props.drafts}
                respondingUserInputId={props.respondingUserInputId}
                onSelectOption={props.onSelectOption}
                onChangeCustomAnswer={props.onChangeCustomAnswer}
                onInputFocusChange={props.onInputFocusChange}
              />
            </View>
          </ScrollView>
          <View
            className="w-full self-center gap-2 border-t border-border pt-3"
            style={{
              maxWidth: layout.contentMaxWidth + layout.horizontalPadding * 2,
              paddingHorizontal: layout.horizontalPadding,
            }}
          >
            <Button
              label="Submit answers"
              fullWidth
              tone={props.answers ? "primary" : "secondary"}
              disabled={!props.canRespond || props.answers === null || responding}
              onPress={() => {
                // Dismiss first: the request resolves out from under this
                // screen, and a modal unmounting mid-flight skips its exit.
                close();
                void props.onSubmit();
              }}
            />
            {props.pendingUserInput.dismissible ? (
              <Pressable
                accessibilityRole="button"
                className="items-center justify-center rounded-2xl px-4 py-2.5 active:opacity-70"
                disabled={responding}
                onPress={() => {
                  close();
                  void props.onDismiss();
                }}
              >
                <Text className="font-t3-bold text-sm text-foreground-muted">
                  Dismiss without answering
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
