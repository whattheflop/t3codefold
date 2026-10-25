import type { ClientSettings } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../test/render";
import { ThemeBackdropSync } from "./themeBackdrop";
import { installCustomTheme, removeCustomTheme } from "./themePalette";

const state = vi.hoisted(() => ({
  theme: "grove",
  appearance: "dark" as "dark" | "light",
  enabled: true,
}));

vi.mock(import("./hooks/useSettings"), () => ({
  useClientSettings: <T,>(select?: (settings: ClientSettings) => T): T => {
    if (!select) throw new Error("Backdrop tests require a settings selector");
    return select({
      ...DEFAULT_UNIFIED_SETTINGS,
      themeBackdropEnabled: state.enabled,
      // Existing installations retain this value when upgrading.
      themeBackdropScope: "featured",
      themeBackdropDynamic: false,
    });
  },
}));
vi.mock(import("./hooks/useTheme"), () => ({
  useTheme: () => ({
    theme: state.theme,
    themeHalves: null,
    resolvedTheme: state.appearance,
    setTheme: () => true,
    setAppearanceMode: () => true,
    setFollowSystem: () => true,
    setThemeHalf: () => true,
    clearThemeHalves: () => true,
    refreshTheme: () => {},
    followSystem: false,
    appearanceMode: state.appearance,
  }),
}));
vi.mock(import("./state/foldMergedPullRequests"), () => ({ useMergedPullRequests: () => [] }));

function setup(theme: string, appearance: "light" | "dark") {
  state.theme = theme;
  state.appearance = appearance;
  state.enabled = true;
  delete document.documentElement.dataset.themeBackdrop;
  for (const layer of ["a", "b", "field"]) {
    document.documentElement.style.removeProperty(`--backdrop-${layer}`);
  }
}

it.each(
  ["light", "dark", ...BUILT_IN_THEMES.map((theme) => theme.id)].flatMap((theme) =>
    (["light", "dark"] as const).map((appearance) => ({ theme, appearance })),
  ),
)("paints $theme in $appearance with legacy settings", async ({ theme, appearance }) => {
  setup(theme, appearance);
  // The document-level painter has no route dependencies.
  await using screen = await render(<ThemeBackdropSync />, { router: false });
  expect(document.documentElement.dataset.themeBackdrop).toBe("on");
  const url = document.documentElement.style.getPropertyValue("--backdrop-a");
  const svg = await fetch(url.slice(5, -2)).then((response) => response.text());
  expect(svg).toContain("<svg");
  expect(svg).toContain("<path");
  await screen.rerender(<ThemeBackdropSync />);
  expect(document.documentElement.style.getPropertyValue("--backdrop-a")).toBe(url);
});

it("paints an imported theme and removes the artwork when disabled", async () => {
  const theme = installCustomTheme({
    ...BUILT_IN_THEMES[0]!,
    id: "fold-splatter-test",
    label: "Splatter test",
  });
  using _theme = { [Symbol.dispose]: () => removeCustomTheme(theme.id) };
  setup(theme.id, "light");
  // The document-level painter has no route dependencies.
  await using screen = await render(<ThemeBackdropSync />, { router: false });
  expect(document.documentElement.dataset.themeBackdrop).toBe("on");
  state.enabled = false;
  await screen.rerender(<ThemeBackdropSync />);
  expect(document.documentElement.dataset.themeBackdrop).toBeUndefined();
  expect(document.documentElement.style.getPropertyValue("--backdrop-a")).toBe("");
});
