import type { GamingHudState } from "@t3tools/contracts";
import * as Electron from "electron";

const hudWindows = new WeakSet<Electron.BrowserWindow>();

export function isGamingHudWindow(window: Electron.BrowserWindow) {
  return hudWindows.has(window);
}

// This window has no preload or app credentials and only receives activity counts.
const HUD_WIDTH = 280;
const HUD_HEIGHT = 40;
const document = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}body{margin:0;padding:4px;font:11px system-ui;color:#9292a3;background:transparent}
main{height:32px;display:flex;align-items:center;justify-content:space-between;gap:4px;padding:0 8px;border:1px solid #ffffff18;border-radius:8px;background:#14141ed9;white-space:nowrap}
.brand{font-size:10px;font-weight:600;color:#727283}.status{display:flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums}
b{font-weight:600;color:#dedee7}.attention[data-active="true"],.attention[data-active="true"] b{color:#fbbf24}
.offline{width:5px;height:5px;flex-shrink:0;border-radius:50%;background:#f87171}[hidden]{display:none}
</style></head><body><main aria-label="T3 Code agent activity"><span class="brand">T3</span>
<span class="status"><b id="running">–</b> running</span>
<span id="waiting-status" class="status" hidden><b id="waiting">0</b> waiting</span>
<span id="attention-status" class="status attention"><b id="attention">–</b> need you</span>
<span id="offline" class="offline" hidden aria-label="Environment disconnected"></span></main>
<script>
window.updateHud = (environments) => {
 const live = environments.filter(e => e.connected);
 const offline = environments.length - live.length;
 const running = live.reduce((n,e) => n+e.running,0);
 const waiting = live.reduce((n,e) => n+e.waiting,0);
 const count = live.reduce((n,e) => n+e.attentionCount,0);
 const format = n => n > 999 ? '999+' : String(n);
 document.getElementById('running').textContent = live.length ? format(running) : '–';
 document.getElementById('attention').textContent = live.length ? format(count) : '–';
 document.getElementById('waiting').textContent = format(waiting);
 document.getElementById('waiting-status').hidden = !waiting;
 document.getElementById('attention-status').dataset.active = String(count > 0);
 const indicator = document.getElementById('offline');
 indicator.hidden = !offline && environments.length > 0;
 indicator.title = offline ? offline + ' environment(s) disconnected; counts may be incomplete' : 'No connected environments';
 const summary = live.length ? running + ' running, ' + waiting + ' waiting, ' + count + ' need you' : 'No connected environments';
 document.querySelector('main').setAttribute('aria-label', 'T3 Code: ' + summary + (offline ? '; ' + indicator.title : ''));
};
</script></body></html>`;

export function gamingHudBounds(area: Electron.Rectangle, position: GamingHudState["position"]) {
  const width = Math.min(HUD_WIDTH, area.width);
  const height = Math.min(HUD_HEIGHT, area.height);
  const margin = 16;
  return {
    width,
    height,
    x: position.endsWith("right")
      ? area.x + Math.max(0, area.width - width - margin)
      : area.x + Math.min(margin, area.width - width),
    y: position.startsWith("bottom")
      ? area.y + Math.max(0, area.height - height - margin)
      : area.y + Math.min(margin, area.height - height),
  };
}

/** One HUD per renderer. Closing or reloading its owner discards its status. */
export function createGamingHud(owner: Electron.BrowserWindow) {
  let window: Electron.BrowserWindow | null = null;
  let loading: Promise<void> | null = null;
  let latest: GamingHudState | null = null;
  let lastPosition: GamingHudState["position"] | null = null;
  let disposed = false;
  const hide = () => {
    latest = null;
    window?.destroy();
    window = null;
    loading = null;
    lastPosition = null;
  };
  const positionWindow = () => {
    if (!window || window.isDestroyed() || !latest || owner.isDestroyed()) return;
    const area = Electron.screen.getDisplayMatching(owner.getBounds()).workArea;
    window.setBounds(gamingHudBounds(area, latest.position));
  };
  const reset = () => hide();
  owner.webContents.on("did-start-loading", reset);
  owner.webContents.on("render-process-gone", reset);
  owner.on("move", positionWindow);
  Electron.screen.on("display-metrics-changed", positionWindow);
  Electron.screen.on("display-removed", positionWindow);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    hide();
    owner.webContents.removeListener("did-start-loading", reset);
    owner.webContents.removeListener("render-process-gone", reset);
    owner.removeListener("move", positionWindow);
    owner.removeListener("closed", dispose);
    Electron.screen.removeListener("display-metrics-changed", positionWindow);
    Electron.screen.removeListener("display-removed", positionWindow);
  };
  owner.once("closed", dispose);
  return {
    dispose,
    async update(state: GamingHudState) {
      if (disposed || owner.isDestroyed()) return;
      if (!state.enabled) {
        hide();
        return;
      }
      latest = state;
      if (!window || window.isDestroyed()) {
        window = new Electron.BrowserWindow({
          title: "T3 Code Gaming HUD",
          width: HUD_WIDTH,
          height: HUD_HEIGHT,
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: "#00000000",
          alwaysOnTop: true,
          focusable: false,
          skipTaskbar: true,
          resizable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          hasShadow: false,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        hudWindows.add(window);
        window.setIgnoreMouseEvents(true);
        window.setAlwaysOnTop(true, "screen-saver");
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        window.webContents.on("will-navigate", (event) => event.preventDefault());
        loading = window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
        positionWindow();
      }
      const target = window;
      if (lastPosition !== state.position) {
        positionWindow();
        lastPosition = state.position;
      }
      try {
        await loading;
      } catch (error) {
        if (target !== window || target.isDestroyed()) return;
        hide();
        throw error;
      }
      // A disable, reload, or newer update may have arrived while loading.
      if (target !== window || target.isDestroyed() || latest !== state) return;
      try {
        await target.webContents.executeJavaScript(
          `window.updateHud(${JSON.stringify(state.environments)})`,
        );
      } catch (error) {
        if (target !== window || target.isDestroyed()) return;
        hide();
        throw error;
      }
      if (target === window && !target.isDestroyed() && !target.isVisible()) target.showInactive();
    },
  };
}
