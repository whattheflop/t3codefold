export function resolveAgentAwarenessPlatformPresentation(platform: string): {
  readonly supported: boolean;
  readonly subtitle: string | undefined;
} {
  // Fold delivers Android agent notifications locally, so they need a live connection.
  if (platform === "android") {
    return { supported: true, subtitle: "While connected in the background" };
  }
  return platform === "ios" || platform === "android"
    ? { supported: true, subtitle: undefined }
    : { supported: false, subtitle: "Unavailable on this platform" };
}
