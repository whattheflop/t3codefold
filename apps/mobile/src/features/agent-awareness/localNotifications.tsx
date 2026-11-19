import { useAtomValue } from "@effect/atom-react";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { AsyncResult } from "effect/reactivity";

import { useThreadShells } from "../../state/entities";
import { mobilePreferencesAtom } from "../../state/preferences";
import {
  indexNotificationThreads,
  localAgentNotificationEvents,
  type LocalAgentNotificationEvent,
} from "./localNotificationEvents";

import {
  ANDROID_AGENT_NOTIFICATION_CHANNEL,
  ensureAndroidAgentNotificationChannel,
} from "./localNotificationChannel";
export {
  ANDROID_AGENT_NOTIFICATION_CHANNEL,
  ensureAndroidAgentNotificationChannel,
} from "./localNotificationChannel";

function notificationContent(event: LocalAgentNotificationEvent) {
  const presentation =
    event.kind === "approval"
      ? { title: "Approval required", body: `${event.threadTitle} needs your approval.` }
      : event.kind === "input"
        ? { title: "Input required", body: `${event.threadTitle} needs your response.` }
        : event.kind === "failure"
          ? { title: "Task failed", body: `${event.threadTitle} stopped with an error.` }
          : { title: "Task completed", body: event.threadTitle };
  return {
    ...presentation,
    data: {
      environmentId: event.environmentId,
      threadId: event.threadId,
      deepLink: `/threads/${encodeURIComponent(event.environmentId)}/${encodeURIComponent(event.threadId)}`,
    },
    sound: "default" as const,
  };
}

async function presentLocalAgentNotification(event: LocalAgentNotificationEvent): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: notificationContent(event),
    trigger:
      Platform.OS === "android"
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 1,
            channelId: ANDROID_AGENT_NOTIFICATION_CHANNEL,
          }
        : null,
  });
}

export function LocalAgentNotificationsCoordinator() {
  const threads = useThreadShells();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const previousThreads = useRef(indexNotificationThreads(threads));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- creates the Android notification channel once
  useEffect(() => {
    void ensureAndroidAgentNotificationChannel().catch((error: unknown) => {
      console.warn("Could not create the Android agent notification channel.", error);
    });
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- posts local Android notifications for thread transitions from the shell atom
  useEffect(() => {
    const events = localAgentNotificationEvents({
      previous: previousThreads.current,
      current: threads,
    });
    previousThreads.current = indexNotificationThreads(threads);

    const enabled =
      Platform.OS === "android" &&
      AsyncResult.isSuccess(preferences) &&
      preferences.value.notificationsEnabled === true;
    if (!enabled || AppState.currentState === "active") return;

    for (const event of events) {
      void presentLocalAgentNotification(event).catch((error: unknown) => {
        console.warn("Could not present an Android agent notification.", error);
      });
    }
  }, [preferences, threads]);

  return null;
}
