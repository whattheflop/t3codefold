import { expect, it } from "vite-plus/test";
import withAndroidTabletOrientation from "./withAndroidTabletOrientation.cjs";
import withFoldAndroidWindow from "./withFoldAndroidWindow.cjs";

it("preserves Expo configuration handling and adds density without duplicate flags across prebuilds", async () => {
  const config = withFoldAndroidWindow({ name: "Test", slug: "test" });
  const manifest = {
    manifest: {
      application: [
        {
          activity: [
            {
              $: {
                "android:name": ".MainActivity",
                "android:configChanges": "orientation|screenSize|smallestScreenSize|uiMode",
              },
            },
          ],
        },
      ],
    },
  };
  const transform = async (modResults) =>
    (
      await config.mods.android.manifest({
        ...config,
        modRequest: { platform: "android", modName: "manifest", introspect: false },
        modResults,
      })
    ).modResults;
  const first = await transform(manifest);
  const second = await transform(first);
  expect(second.manifest.application[0].activity[0].$["android:configChanges"].split("|")).toEqual([
    "orientation",
    "screenSize",
    "smallestScreenSize",
    "uiMode",
    "density",
  ]);
});

it("unlocks rotation on every Android window after upstream's tablet-only policy", async () => {
  const config = withAndroidTabletOrientation(
    withFoldAndroidWindow({ name: "Test", slug: "test" }),
  );
  const template = [
    "package com.example",
    "import android.os.Bundle",
    "class MainActivity : ReactActivity() {",
    "  override fun onCreate(savedInstanceState: Bundle?) {",
    "    super.onCreate(null)",
    "  }",
    "}",
  ].join("\n");
  const transform = async (contents) =>
    (
      await config.mods.android.mainActivity({
        ...config,
        modRequest: { platform: "android", modName: "mainActivity", introspect: false },
        modResults: { language: "kt", contents },
      })
    ).modResults.contents;
  const first = await transform(template);
  expect(first).toContain("requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_USER");
  expect(first).not.toContain("SCREEN_ORIENTATION_PORTRAIT");
  expect(await transform(first)).toBe(first);
});
