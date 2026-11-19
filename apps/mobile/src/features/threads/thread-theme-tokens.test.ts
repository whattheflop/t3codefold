import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { readDefaultMobileThemeVariables } from "../../lib/mobileTheme.test-support";

/**
 * A colour class naming a token the theme does not define produces no style at all, so the
 * element falls back to React Native's defaults — black text, transparent fill. That passes for
 * correct against a light background and disappears in dark mode, which is how
 * `text-muted-foreground` survived on the thread surfaces: the real token is `foreground-muted`.
 */
const THREAD_SURFACES = ["thread-work-log.tsx"];

/** Names that read as plausible but the theme has never defined. */
const UNDEFINED_LOOKALIKES = ["muted-foreground", "foreground-subtle", "muted", "background"];

const readSurface = (file: string) =>
  NodeFS.readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

describe("Thread surface colour tokens", () => {
  const defined = new Set(
    Object.keys(readDefaultMobileThemeVariables("dark")).map((name) =>
      name.replace(/^--color-/u, ""),
    ),
  );

  it.each(UNDEFINED_LOOKALIKES)("the theme does not define %s", (token) => {
    expect(defined.has(token)).toBe(false);
  });

  it.each(["foreground-muted", "subtle", "screen", "card", "primary"])(
    "the theme defines %s",
    (token) => {
      expect(defined.has(token)).toBe(true);
    },
  );

  it.each(THREAD_SURFACES)("%s uses none of the undefined lookalikes", (file) => {
    const source = readSurface(file);
    const used = UNDEFINED_LOOKALIKES.filter((token) =>
      new RegExp(`(?:bg|text|border)-${token}(?:/\\d+)?(?=["'\`\\s])`, "u").test(source),
    );

    expect(used).toEqual([]);
  });
});
