import { msg } from "gt-react-native";

import { m, type MessageResolver } from "../../i18n/messages";

export function resolveAgentAwarenessPlatformPresentation(
  platform: string,
  resolve: MessageResolver = m,
): {
  readonly supported: boolean;
  readonly subtitle: string | undefined;
} {
  // Fold delivers Android agent notifications locally, so they need a live connection.
  if (platform === "android") {
    return { supported: true, subtitle: resolve(msg("While connected in the background")) };
  }
  return platform === "ios"
    ? { supported: true, subtitle: undefined }
    : { supported: false, subtitle: resolve(msg("Unavailable on this platform")) };
}
