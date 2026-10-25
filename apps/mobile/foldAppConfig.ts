import type { ExpoConfig } from "expo/config";

// Fold's identity and release channel, applied over upstream's Expo config so
// app.config.ts keeps upstream's values and merges cleanly. The app `version`
// stays in app.config.ts because fingerprint.config.js reads it from that file.
const FOLD_ANDROID_VERSION_CODE = 23;
const FOLD_PRODUCTION = { name: "T3 Code Fold", androidPackage: "com.breakthebeta.t3code" };
const FOLD_OWNER = "whattheflop";
// GitHub hosts the fork's protocol manifest and content-addressed assets.
// Fingerprinted runtimes prevent JavaScript from crossing native revisions.
const FOLD_UPDATES_URL =
  "https://raw.githubusercontent.com/whattheflop/T3codefold/mobile-ota/manifest-android.json";

export function withFoldAppConfig(
  config: ExpoConfig,
  options: { readonly appVariant: string; readonly runtimeVersionPolicy: string },
): ExpoConfig {
  // EAS resolves the fingerprint policy to a real runtime version at build time. A local
  // prebuild cannot, so it emits the literal "file:fingerprint" and the binary can never match
  // a published manifest. Leaving updates on there costs a launch-time check against a runtime
  // version that will never resolve, which hangs the splash before JavaScript starts. Sideload
  // builds ship self-contained instead.
  const resolvesFingerprintRuntimeVersion =
    options.runtimeVersionPolicy !== "fingerprint" || process.env.EAS_BUILD === "true";
  const isProduction = options.appVariant === "production";
  const { eas, ...extra } = config.extra ?? {};
  const projectId = process.env.T3CODE_EAS_PROJECT_ID;

  return {
    ...config,
    ...(isProduction ? { name: FOLD_PRODUCTION.name } : {}),
    updates: {
      ...config.updates,
      enabled: options.appVariant === "preview" && resolvesFingerprintRuntimeVersion,
      url: FOLD_UPDATES_URL,
    },
    android: {
      ...config.android,
      versionCode: FOLD_ANDROID_VERSION_CODE,
      ...(isProduction ? { package: FOLD_PRODUCTION.androidPackage } : {}),
    },
    extra: {
      ...extra,
      ...(projectId ? { eas: { ...eas, projectId } } : {}),
    },
    owner: process.env.T3CODE_EXPO_OWNER ?? FOLD_OWNER,
  };
}
