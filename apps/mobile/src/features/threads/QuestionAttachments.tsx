import { useQuestionDraftText } from "./useQuestionDraftText";
import { ControllerPressable } from "../controller/ControllerPressable";
import { useVoiceInputController } from "../voice-input/useVoiceInputController";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import { AsyncResult } from "effect/reactivity";
import * as Dialog from "../../components/ui/Dialog";
import { TextInputWrapper } from "expo-paste-input";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { useNativePaste } from "../../lib/useNativePaste";
import { convertPastedImagesToAttachments } from "../../lib/composerImages";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS, type UserInputQuestion } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { View, type TextInputInstance } from "react-native";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { ComposerAttachmentButton } from "./ComposerAttachmentButton";
import { ComposerAttachmentStrip } from "../../components/ComposerAttachmentStrip";
import { pickComposerFiles, pickComposerMedia } from "../../lib/composerImages";
import { useThreadSelection } from "../../state/use-thread-selection";
import { useNavigation } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { m } from "../../i18n/messages";
import { FilePreviewModal, type FilePreviewSource } from "../../components/ui/FilePreviewModal";
import { VideoPreviewModal, type VideoPreviewSource } from "../../components/ui/VideoPreviewModal";
import { useServerConfigs } from "../../state/entities";
import { appAtomRegistry } from "../../state/atom-registry";
import {
  appendComposerDraftAttachments,
  composerDraftsAtom,
  removeComposerDraftAttachment,
  releaseUnusedComposerAttachmentFiles,
} from "../../state/use-composer-drafts";
import {
  changeQuestionAttachmentPreparation,
  questionAttachmentDraftKey,
  questionAttachmentPreparationAtom,
} from "../../state/question-attachments";

export function QuestionAttachments(props: {
  requestId: string;
  question: UserInputQuestion;
  questions: ReadonlyArray<UserInputQuestion>;
  disabled: boolean;
  value: string;
  onChangeText: (value: string) => void;
  onInputFocusChange?: ((focused: boolean) => void) | undefined;
}) {
  const dictationInstance = useId();
  const gt = useGT();
  const { selectedThread } = useThreadSelection();
  const navigation = useNavigation();
  const [previewFile, setPreviewFile] = useState<FilePreviewSource | null>(null);
  const [previewVideo, setPreviewVideo] = useState<VideoPreviewSource | null>(null);
  const configs = useServerConfigs();
  const drafts = useAtomValue(composerDraftsAtom);
  const focusedRef = useRef(false);
  const onInputFocusChange = props.onInputFocusChange;
  // The caller keys this component by request and question, so unmounting ends any open
  // picker's scope.
  const pickerScope = useRef<{ active: boolean }>({ active: false });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens a scope that native picker and paste callbacks check, and closes it on unmount
  useEffect(() => {
    const scope = { active: true };
    pickerScope.current = scope;
    return () => {
      scope.active = false;
    };
  }, []);
  // Unmounted inputs never emit onBlur; explicitly release keyboard ownership.
  const releaseFocus = useEffectEvent(() => {
    if (focusedRef.current) onInputFocusChange?.(false);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases keyboard ownership on unmount, since an unmounted native input never emits blur
  useEffect(() => () => releaseFocus(), []);
  const inputRef = useRef<TextInputInstance>(null);
  const { initialText, readNativeText, onNativeTextChange } = useQuestionDraftText(
    props.value,
    inputRef,
  );
  const [selection, setSelection] = useState({
    start: props.value.length,
    end: props.value.length,
  });
  const voice = useVoiceInputController({
    ownerKey: selectedThread
      ? `question:${selectedThread.environmentId}:${selectedThread.id}:${props.requestId}:${props.question.id}:${dictationInstance}`
      : null,
    label: props.question.header,
    readDraftMessage: readNativeText,
    selection,
    disabled: props.disabled,
    onChangeDraftMessage: props.onChangeText,
    onChangeSelection: setSelection,
  });
  const append = (
    key: string,
    attachments: Parameters<typeof appendComposerDraftAttachments>[1],
  ) => {
    if (!selectedThread) return 0;
    const current = appAtomRegistry.get(composerDraftsAtom);
    const otherCount = props.questions.reduce((count, question) => {
      const target = questionAttachmentDraftKey(
        selectedThread.environmentId,
        selectedThread.id,
        props.requestId,
        question.id,
      );
      return target === key ? count : count + (current[target]?.attachments.length ?? 0);
    }, 0);
    return appendComposerDraftAttachments(key, attachments, {
      maxAttachments: Math.max(0, PROVIDER_SEND_TURN_MAX_ATTACHMENTS - otherCount),
    });
  };
  const paste = useNativePaste((uris) => {
    const scope = pickerScope.current;
    if (!selectedThread || props.disabled || !configs.get(selectedThread.environmentId)) return;
    const key = questionAttachmentDraftKey(
      selectedThread.environmentId,
      selectedThread.id,
      props.requestId,
      props.question.id,
    );
    changeQuestionAttachmentPreparation(key, 1);
    void convertPastedImagesToAttachments({ uris })
      .then(async (result) => {
        if (
          scope.active &&
          (appAtomRegistry.get(questionAttachmentPreparationAtom)[key] ?? 0) > 0
        ) {
          const problems = [
            ...(result.error ? [result.error] : []),
            ...(append(key, result.attachments) > 0 ? [gt("Too many attachments.")] : []),
          ];
          if (problems.length) Dialog.alert(gt("Could not paste image"), problems.join("\n\n"));
        } else await releaseUnusedComposerAttachmentFiles(result.attachments);
      })
      .catch((error) =>
        Dialog.alert(
          gt("Could not paste image"),
          errorDisplayMessage(error, m) ?? gt("Try again."),
        ),
      )
      .finally(() => changeQuestionAttachmentPreparation(key, -1));
  });
  if (!selectedThread || props.question.allowCustomAnswer === false) return null;
  const { environmentId, id: threadId } = selectedThread;
  const capabilities = configs.get(environmentId)?.environment.capabilities;
  const canAttach = capabilities !== undefined;
  const key = questionAttachmentDraftKey(
    environmentId,
    threadId,
    props.requestId,
    props.question.id,
  );
  const attachments = drafts[key]?.attachments ?? [];
  const pick = async (kind: "media" | "files") => {
    const scope = pickerScope.current;
    changeQuestionAttachmentPreparation(key, 1);
    const picked = await settlePromise(async () => {
      const existingCount = appAtomRegistry.get(composerDraftsAtom)[key]?.attachments.length ?? 0;
      const result =
        kind === "files"
          ? await pickComposerFiles({
              existingCount,
              maxBytes: capabilities?.fileAttachments?.maxUploadBytes,
            })
          : await pickComposerMedia({
              existingCount,
              maxVideoBytes: capabilities?.fileAttachments?.maxUploadBytes,
            });
      const picked = "files" in result ? result.files : result.attachments;
      // Resolution on another client clears the reservation while the picker is open.
      if (
        !scope.active ||
        (appAtomRegistry.get(questionAttachmentPreparationAtom)[key] ?? 0) === 0
      ) {
        await releaseUnusedComposerAttachmentFiles(picked);
        return;
      }
      const rejected = append(key, picked);
      if (result.error || rejected > 0)
        Dialog.alert(gt("Could not attach file"), result.error ?? gt("Too many attachments."));
    });
    changeQuestionAttachmentPreparation(key, -1);
    if (AsyncResult.isFailure(picked)) {
      const error = squashAtomCommandFailure(picked);
      Dialog.alert(gt("Could not attach file"), errorDisplayMessage(error, m) ?? gt("Try again."));
    }
  };
  return (
    <View className="gap-2">
      {canAttach ? (
        <ComposerAttachmentButton
          disabled={props.disabled}
          supportsFiles
          onPickMedia={() => pick("media")}
          onPickFiles={() => pick("files")}
        />
      ) : null}
      <ComposerAttachmentStrip
        environmentId={environmentId}
        attachments={attachments}
        onRemove={(id) => {
          if (!props.disabled) removeComposerDraftAttachment(key, id);
        }}
        onPressPreview={setPreviewFile}
        onPressVideo={(attachment, sourceIdentifier) =>
          setPreviewVideo({ type: "local", attachment, sourceIdentifier })
        }
        onPressDocument={(attachment) =>
          navigation.navigate("ThreadAttachment", {
            environmentId: String(environmentId),
            threadId: String(threadId),
            attachmentId: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: String(attachment.sizeBytes),
            draftKey: key,
          })
        }
      />
      <FilePreviewModal source={previewFile} onRequestClose={() => setPreviewFile(null)} />
      <VideoPreviewModal source={previewVideo} onRequestClose={() => setPreviewVideo(null)} />
      <ControllerPressable
        controllerKey={`${props.requestId}:${props.question.id}`}
        accessibilityLabel={gt("Edit {header}. Square dictates", { header: props.question.header })}
        disabled={props.disabled}
        onActivate={() => inputRef.current?.focus()}
        onPress={() => inputRef.current?.focus()}
        onDictate={() => {
          if (voice.isBusy) voice.stop();
          else if (voice.isAvailable) voice.start();
        }}
      >
        <TextInputWrapper onPaste={paste}>
          <TextInput
            ref={inputRef}
            defaultValue={initialText}
            multiline={props.question.initialAnswer !== undefined}
            submitBehavior={props.question.initialAnswer !== undefined ? "newline" : undefined}
            editable={!props.disabled && !voice.freezesEditor}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            onChangeText={(text) => {
              onNativeTextChange(text);
              props.onChangeText(text);
            }}
            onFocus={() => {
              focusedRef.current = true;
              onInputFocusChange?.(true);
            }}
            onBlur={() => {
              focusedRef.current = false;
              onInputFocusChange?.(false);
            }}
            placeholder={gt("Or type a custom answer")}
            className="min-h-[54px] rounded-2xl border border-input-border bg-input px-3.5 py-3 font-sans text-base text-foreground"
          />
        </TextInputWrapper>
      </ControllerPressable>
      {voice.isBusy ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-secondary">
          {gt("Dictating {header} · Square finishes · Circle cancels", {
            header: props.question.header,
          })}
        </Text>
      ) : voice.state.phase === "error" ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-danger-foreground">
          {voice.state.error}
        </Text>
      ) : null}
    </View>
  );
}
