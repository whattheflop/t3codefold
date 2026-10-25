import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ClientSettingsPatch, ClientSettingsSchema } from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);

describe("ClientSettings Fold fields", () => {
  it("decodes defaults for settings saved before the Fold fields existed", () => {
    expect(decodeClientSettings({})).toMatchObject({
      themeBackdropEnabled: true,
      themeBackdropScope: "all",
      themeBackdropColors: null,
      themeBackdropIntensity: 100,
      themeBackdropSeed: 0,
      citeSelectionEnabled: true,
      vimModeEnabled: false,
      vimThreadPreviewEnabled: false,
    });
  });

  it("round-trips patches and rejects out-of-range backdrop values", () => {
    const preference = {
      vimModeEnabled: true,
      themeBackdropColors: ["#112233", "#445566", "#778899"],
    };
    expect(decodeClientSettingsPatch(preference)).toEqual(preference);
    expect(encodeClientSettings(decodeClientSettings(preference))).toMatchObject(preference);
    expect(() => decodeClientSettingsPatch({ themeBackdropIntensity: 1 })).toThrow();
  });

  it("preserves older backdrop preferences and an explicit off switch", () => {
    const preference = { themeBackdropScope: "featured", themeBackdropEnabled: false };
    expect(encodeClientSettings(decodeClientSettings(preference))).toMatchObject(preference);
    expect(decodeClientSettingsPatch(preference)).toEqual(preference);
  });
});

describe("ClientSettings thread wrapping", () => {
  it("is off with three columns for existing settings", () => {
    const settings = decodeClientSettings({});
    expect(settings.threadWrapEnabled).toBe(false);
    expect(settings.threadWrapPortalsEnabled).toBe(true);
    expect(settings.threadWrapMaxColumns).toBe(3);
  });

  it("persists an explicit choice to hide portals", () => {
    const preference = { threadWrapPortalsEnabled: false };
    expect(decodeClientSettingsPatch(preference)).toEqual(preference);
    expect(encodeClientSettings(decodeClientSettings(preference))).toMatchObject(preference);
  });

  it("rejects column limits outside two to four", () => {
    expect(decodeClientSettingsPatch({ threadWrapMaxColumns: 4 }).threadWrapMaxColumns).toBe(4);
    expect(() => decodeClientSettings({ threadWrapMaxColumns: 1 })).toThrow();
    expect(() => decodeClientSettingsPatch({ threadWrapMaxColumns: 5 })).toThrow();
  });
});

describe("ClientSettings gaming HUD", () => {
  it("defaults off and persists its corner on this client", () => {
    expect(decodeClientSettings({})).toMatchObject({
      gamingHudEnabled: false,
      gamingHudPosition: "top-right",
    });
    const patch = { gamingHudEnabled: true, gamingHudPosition: "bottom-left" };
    expect(decodeClientSettingsPatch(patch)).toEqual(patch);
    expect(encodeClientSettings(decodeClientSettings(patch))).toMatchObject(patch);
    expect(() => decodeClientSettingsPatch({ gamingHudPosition: "center" })).toThrow();
  });
});
