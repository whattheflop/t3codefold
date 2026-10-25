import { describe, expect, it } from "vite-plus/test";

import { splatterHexToHue, splatterHueToHex, themeSplatterColors } from "./splatterColors";
import { MOBILE_THEME_IDS } from "@t3tools/shared/themePalettes";
import { deriveSplatterColors, hexToOklch } from "@t3tools/shared/splatterBackdrop";

describe("splatter hue picker", () => {
  it("reads back the hue it set, so dragging a slider never drifts", () => {
    for (let hue = 0; hue < 360; hue += 5) {
      expect(splatterHexToHue(splatterHueToHex(hue))).toBe(hue);
    }
  });

  it("starts a slider from a colour picked on web", () => {
    expect(splatterHexToHue("#ff3dcb")).toBeGreaterThan(330);
    expect(splatterHexToHue("#39ff88")).toBeGreaterThan(140);
    expect(splatterHexToHue("#39ff88")).toBeLessThan(160);
  });
});

it("derives theme paint on every theme, including ones with no palette of their own", () => {
  for (const themeId of [...MOBILE_THEME_IDS, "material-you"] as const) {
    for (const appearance of ["dark", "light"] as const) {
      for (const color of themeSplatterColors(themeId, appearance)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  }
});

it("uses Android's active Material You palette instead of the default theme palette", () => {
  const variables = { "--color-primary": "#ff3344ff", "--color-md-link": "#44cc88ff" };
  expect(themeSplatterColors("material-you", "dark", variables)).toEqual(
    deriveSplatterColors(hexToOklch("#ff3344"), hexToOklch("#44cc88"), "dark"),
  );
});
