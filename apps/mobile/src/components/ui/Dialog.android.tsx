import { androidKeyboardFirst } from "../../lib/android-back";
import { useState, useSyncExternalStore } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { ControllerConsole } from "../../features/controller/ControllerConsole";
import { ControllerTextInput } from "./ControllerTextInput";
import { AppText } from "./AppText";
import { Button as AppButton } from "./Button";
import type { Alert, AlertButton } from "react-native";
import type { ConfirmDialogRequest, TextInputDialogRequest } from "./Dialog.types";

export type { ConfirmDialogRequest, TextInputDialogRequest } from "./Dialog.types";

type AlertRequest = {
  readonly title: Parameters<typeof Alert.alert>[0];
  readonly message: Parameters<typeof Alert.alert>[1];
  readonly buttons: Parameters<typeof Alert.alert>[2];
  readonly options: Parameters<typeof Alert.alert>[3];
};

type DialogRequest =
  | { readonly kind: "alert"; readonly request: AlertRequest }
  | { readonly kind: "confirm"; readonly request: ConfirmDialogRequest }
  | { readonly kind: "text-input"; readonly request: TextInputDialogRequest };

type PresentedDialog = DialogRequest & { readonly id: number };

// App services raise dialogs before the root mounts, so the request lives in
// the module and the Host renders whatever is current. One dialog shows at a
// time: a new request replaces the presented one.
let presented: PresentedDialog | null = null;
let nextPresentationId = 0;
const listeners = new Set<() => void>();

function setPresented(next: PresentedDialog | null) {
  presented = next;
  for (const listener of listeners) listener();
}

function submitRequest(dialog: DialogRequest) {
  const replaced = presented;
  setPresented({ ...dialog, id: ++nextPresentationId });
  // A replaced alert closed without an answer, which its owner hears as a dismissal.
  if (replaced?.kind === "alert") replaced.request.options?.onDismiss?.();
}

/** Closes the dialog only if it is still the one the action came from. */
function dismiss(id: number) {
  if (presented?.id === id) setPresented(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getPresented() {
  return presented;
}

export function alert(...[title, message, buttons, options]: Parameters<typeof Alert.alert>): void {
  const actions = buttons?.length ? buttons.slice(0, 3) : [{ text: "OK" }];
  const normalized = actions.map((action, index) =>
    index === actions.length - 1 ? { ...action, text: action.text || "OK" } : action,
  );
  submitRequest({
    kind: "alert",
    request: { title, message, buttons: normalized, options },
  });
}

export function confirm(request: ConfirmDialogRequest): void {
  submitRequest({ kind: "confirm", request });
}

export function prompt(request: TextInputDialogRequest): void {
  submitRequest({ kind: "text-input", request });
}

export function Host() {
  const presented = useSyncExternalStore(subscribe, getPresented, getPresented);

  const handleCancel = () => {
    if (!presented) return;
    dismiss(presented.id);
    if (presented.kind === "alert") presented.request.options?.onDismiss?.();
    else presented.request.onCancel?.();
  };

  const handleConfirm = (nativeInputValue?: string) => {
    if (!presented) return;
    dismiss(presented.id);
    if (presented.kind === "confirm") {
      presented.request.onConfirm();
    } else if (presented.kind === "text-input") {
      presented.request.onConfirm(nativeInputValue ?? presented.request.initialValue);
    }
  };

  if (presented?.kind === "alert") {
    return (
      <DialogPresentation
        key={presented.id}
        request={{
          title: presented.request.title ?? "",
          message: presented.request.message ?? undefined,
          confirmText: "",
        }}
        alertActions={presented.request.buttons ?? [{ text: "OK" }]}
        dismissable={presented.request.options?.cancelable ?? false}
        onAlertAction={(action) => {
          dismiss(presented.id);
          action.onPress?.();
        }}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />
    );
  }

  if (presented?.kind === "text-input") {
    return (
      <PromptPresentation
        key={presented.id}
        request={presented.request}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
      />
    );
  }
  return presented ? (
    <DialogPresentation
      key={presented.id}
      request={presented.request}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
    />
  ) : null;
}

function PromptPresentation(props: {
  readonly request: TextInputDialogRequest;
  readonly onCancel: () => void;
  readonly onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(props.request.initialValue);
  return (
    <Modal transparent visible onRequestClose={androidKeyboardFirst(props.onCancel)}>
      <ControllerConsole scopeKey="text-input-dialog" onBack={androidKeyboardFirst(props.onCancel)}>
        <View className="flex-1 justify-center bg-black/40 px-6">
          <View className="gap-4 rounded-[28px] bg-card p-6">
            <AppText className="text-xl font-t3-medium">{props.request.title}</AppText>
            {props.request.message ? <AppText>{props.request.message}</AppText> : null}
            <ControllerTextInput
              autoFocus
              accessibilityLabel={props.request.title}
              placeholder={props.request.placeholder}
              value={value}
              onChangeText={setValue}
              returnKeyType="done"
              onSubmitEditing={() => props.onConfirm(value)}
              selectTextOnFocus
            />
            <View className="flex-row justify-end gap-3">
              <AppButton label={props.request.cancelText ?? "Cancel"} onPress={props.onCancel} />
              <AppButton
                controllerFooter
                label={props.request.confirmText}
                tone="primary"
                onPress={() => props.onConfirm(value)}
              />
            </View>
          </View>
        </View>
      </ControllerConsole>
    </Modal>
  );
}

function DialogPresentation(props: DialogPresentationProps) {
  const cancel = androidKeyboardFirst(() => {
    if (props.dismissable ?? true) props.onCancel();
  });
  const actions = props.alertActions ?? [
    { text: props.request.cancelText ?? "Cancel", onPress: props.onCancel },
    {
      text: props.request.confirmText,
      style: props.request.destructive ? ("destructive" as const) : ("default" as const),
      onPress: () => props.onConfirm(),
    },
  ];
  return (
    <Modal transparent visible onRequestClose={cancel}>
      <ControllerConsole scopeKey="confirmation-dialog" onBack={cancel}>
        <View className="flex-1 justify-center bg-black/40 px-6">
          <Pressable
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            className="absolute inset-0"
            onPress={cancel}
          />
          <View accessibilityViewIsModal className="max-h-[80%] gap-4 rounded-[28px] bg-card p-6">
            <AppText accessibilityRole="header" className="text-xl font-t3-medium">
              {props.request.title}
            </AppText>
            {props.request.message ? (
              <ScrollView className="shrink" keyboardShouldPersistTaps="handled">
                <AppText>{props.request.message}</AppText>
              </ScrollView>
            ) : null}
            <View className="flex-row flex-wrap justify-end gap-3">
              {actions.map((action, index) => (
                <AppButton
                  key={`${action.text}:${action.style ?? "default"}`}
                  label={action.text ?? ""}
                  controllerFooter={index === actions.length - 1}
                  tone={
                    action.style === "destructive"
                      ? "danger"
                      : index === actions.length - 1
                        ? "primary"
                        : "secondary"
                  }
                  onPress={() =>
                    props.alertActions ? props.onAlertAction?.(action) : action.onPress?.()
                  }
                />
              ))}
            </View>
          </View>
        </View>
      </ControllerConsole>
    </Modal>
  );
}

interface DialogPresentationProps {
  readonly alertActions?: readonly AlertButton[];
  readonly onAlertAction?: (action: AlertButton) => void;
  readonly dismissable?: boolean;
  readonly request: Pick<
    ConfirmDialogRequest,
    "title" | "message" | "cancelText" | "confirmText" | "destructive"
  >;
  readonly onCancel: () => void;
  readonly onConfirm: (inputValue?: string) => void;
}
