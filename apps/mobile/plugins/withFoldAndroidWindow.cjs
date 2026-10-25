const { withMainActivity, withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

// Fold's Android window policy, layered over upstream's withAndroidTabletOrientation.
// Expo runs a later plugin's mod first, so app.config.ts lists this plugin *before*
// withAndroidTabletOrientation for its MainActivity mod to see upstream's output.
// Android workspaces support cover-display landscape and resized windows, so
// FULL_USER applies on phones too and respects the system rotation lock.
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
