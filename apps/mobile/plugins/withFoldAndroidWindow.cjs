const { withMainActivity, withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

// Expo runs later mods first: list this before withAndroidTabletOrientation to override its output.
// FULL_USER allows cover-display landscape while respecting the system rotation lock.
const TABLET_ONLY_ORIENTATION =
  /requestedOrientation = if \(resources.configuration.smallestScreenWidthDp >= 600\) \{\s*ActivityInfo.SCREEN_ORIENTATION_FULL_USER\s*\} else \{\s*ActivityInfo.SCREEN_ORIENTATION_PORTRAIT\s*\}/;

module.exports = function withFoldAndroidWindow(config) {
  config = withAndroidManifest(config, (nextConfig) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(nextConfig.modResults);
    // Cover and inner displays can have different densities. Let React Native
    // update window metrics without discarding the open inbox or answer draft.
    const changes = new Set((activity.$["android:configChanges"] ?? "").split("|").filter(Boolean));
    changes.add("density");
    activity.$["android:configChanges"] = [...changes].join("|");
    return nextConfig;
  });
  return withMainActivity(config, (nextConfig) => {
    nextConfig.modResults.contents = nextConfig.modResults.contents.replace(
      TABLET_ONLY_ORIENTATION,
      "requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_USER",
    );
    return nextConfig;
  });
};
