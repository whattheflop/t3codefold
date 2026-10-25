import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as DesktopUpdates from "./DesktopUpdates.ts";
import { makeHarness } from "./updatesTestHarness.ts";

describe("DesktopUpdates on Fold feeds", () => {
  it.effect("replaces an upstream feed and keeps both release channels on Fold", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        appUpdateYml: "provider: github\nowner: pingdotgg\nrepo: t3code\n",
        env: { T3CODE_DESKTOP_MOCK_UPDATES: "false" },
      });
      yield* Effect.gen(function* () {
        const updates = yield* DesktopUpdates.DesktopUpdates;
        yield* updates.configure;
        assert.isTrue((yield* updates.getState).enabled);
        yield* updates.setChannel("nightly");
        assert.deepEqual(harness.feedUrls(), [
          {
            provider: "generic",
            url: "https://github.com/whattheflop/T3codefold/releases/download/fold-desktop-latest",
            channel: "latest",
          },
          {
            provider: "generic",
            url: "https://github.com/whattheflop/T3codefold/releases/download/fold-desktop-nightly",
            channel: "nightly",
          },
        ]);
      }).pipe(Effect.provide(harness.layer));
    }),
  );
});
