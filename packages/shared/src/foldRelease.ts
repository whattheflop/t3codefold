declare const process: {
  readonly env: { readonly EXPO_PUBLIC_T3CODE_RELEASE_REPOSITORY?: string };
};

/** Bundlers embed the checkout's release repository; source-only consumers use Fold's default. */
export const FOLD_REPOSITORY =
  process.env.EXPO_PUBLIC_T3CODE_RELEASE_REPOSITORY || "whattheflop/T3codefold";
const FOLD_RELEASES_URL = `https://github.com/${FOLD_REPOSITORY}/releases`;

const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Whether `version` names a downloadable Fold server release. */
export function isFoldReleaseVersion(version: string): boolean {
  return version === "latest" || version === "nightly" || EXACT_VERSION.test(version);
}

export function foldServerPackageSpec(version: string): string {
  if (version === "latest" || version === "nightly") {
    return `${FOLD_RELEASES_URL}/download/fold-server-${version}/t3.tgz`;
  }
  if (!EXACT_VERSION.test(version)) {
    throw new Error("A Fold server release requires an exact version, latest, or nightly.");
  }
  return `${FOLD_RELEASES_URL}/download/fold-server-v${encodeURIComponent(version)}/t3-${encodeURIComponent(version)}.tgz`;
}

export function foldServerCommand(version: string): string {
  return `npx --yes --prefer-online --package=${foldServerPackageSpec(version)} t3`;
}

/** For manual-update hints built from untrusted versions: never throws, and
    falls back to the latest release when `version` is not an exact release. */
export function manualFoldServerCommand(version: string): string {
  return foldServerCommand(isFoldReleaseVersion(version) ? version : "latest");
}

/** Older update RPCs can install upstream npm packages; they require a manual Fold install. */
export function supportsFoldUpdates(capabilities: { readonly updateRepository?: string }): boolean {
  return capabilities.updateRepository?.toLowerCase() === FOLD_REPOSITORY.toLowerCase();
}

export function foldDesktopFeed(channel: "latest" | "nightly", repository = FOLD_REPOSITORY) {
  return {
    provider: "generic" as const,
    url: `https://github.com/${repository}/releases/download/fold-desktop-${channel}`,
    channel,
  };
}
