import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { GamingHudState } from "@t3tools/contracts";

const native = vi.hoisted(() => ({
  windows: [] as Array<{
    destroyed: boolean;
    visible: boolean;
    options: unknown;
    setIgnoreMouseEvents: ReturnType<typeof vi.fn>;
    setBounds: ReturnType<typeof vi.fn>;
    showInactive: ReturnType<typeof vi.fn>;
    webContents: { executeJavaScript: ReturnType<typeof vi.fn> };
  }>,
}));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class BrowserWindow extends EventEmitter {
    destroyed = false;
    visible = false;
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn(async () => undefined),
    });
    setIgnoreMouseEvents = vi.fn();
    setBounds = vi.fn();
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    showInactive = vi.fn(() => {
      this.visible = true;
    });
    readonly options: unknown;
    constructor(options: unknown) {
      super();
      this.options = options;
      native.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
    async loadURL() {}
  }
  return {
    BrowserWindow,
    screen: Object.assign(new EventEmitter(), {
      getDisplayMatching: () => ({ workArea: { x: 100, y: 50, width: 1920, height: 1080 } }),
    }),
  };
});

import * as Electron from "electron";
import { createGamingHud, gamingHudBounds } from "./GamingHud.ts";

const state: GamingHudState = {
  enabled: true,
  position: "top-right",
  environments: [
    {
      connected: true,
      running: 2,
      waiting: 1,
      attentionCount: 1,
    },
  ],
};

beforeEach(() => {
  native.windows.length = 0;
});

it("positions on the owner's display, including negative coordinates and small displays", () => {
  expect(gamingHudBounds({ x: -1920, y: 0, width: 1920, height: 1080 }, "bottom-right")).toEqual({
    x: -296,
    y: 1024,
    width: 280,
    height: 40,
  });
  expect(gamingHudBounds({ x: 0, y: 0, width: 200, height: 150 }, "top-left")).toEqual({
    x: 0,
    y: 16,
    width: 200,
    height: 40,
  });
});

it("shows without stealing focus, passes clicks through, reuses the window, and disables cleanly", async () => {
  const owner = new Electron.BrowserWindow({});
  owner.getBounds = () => ({ x: 100, y: 50, width: 800, height: 600 });
  const hud = createGamingHud(owner);
  await hud.update(state);
  const overlay = native.windows[1]!;
  expect(overlay.options).toMatchObject({ focusable: false, skipTaskbar: true, alwaysOnTop: true });
  expect(overlay.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
  expect(overlay.showInactive).toHaveBeenCalledOnce();
  expect(overlay.setBounds).toHaveBeenCalledWith({ x: 1724, y: 66, width: 280, height: 40 });
  await hud.update({ ...state, environments: [] });
  expect(native.windows).toHaveLength(2);
  expect(overlay.webContents.executeJavaScript).toHaveBeenLastCalledWith("window.updateHud([])");
  await hud.update({ ...state, enabled: false });
  expect(overlay.destroyed).toBe(true);
  hud.dispose();
});

it("discards stale status on reload and removes display listeners when its owner closes", async () => {
  const owner = new Electron.BrowserWindow({});
  owner.getBounds = () => ({ x: 100, y: 50, width: 800, height: 600 });
  const before = Electron.screen.listenerCount("display-metrics-changed");
  const hud = createGamingHud(owner);
  await hud.update(state);
  owner.webContents.emit("did-start-loading");
  expect(native.windows[1]?.destroyed).toBe(true);
  await hud.update(state);
  owner.emit("closed");
  expect(native.windows[2]?.destroyed).toBe(true);
  expect(Electron.screen.listenerCount("display-metrics-changed")).toBe(before);
  await hud.update(state);
  expect(native.windows).toHaveLength(3);
});

it("a disable during initial loading never reveals the pending window", async () => {
  const owner = new Electron.BrowserWindow({});
  owner.getBounds = () => ({ x: 100, y: 50, width: 800, height: 600 });
  const hud = createGamingHud(owner);
  const pending = hud.update(state);
  await hud.update({ ...state, enabled: false });
  await pending;
  expect(native.windows[1]?.showInactive).not.toHaveBeenCalled();
  hud.dispose();
});
