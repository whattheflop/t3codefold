import { GamingHudState } from "@t3tools/contracts";
import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { createGamingHud } from "../../gamingHud/GamingHud.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_GAMING_HUD_CHANNEL } from "../channels.ts";

class GamingHudError extends Schema.TaggedError<GamingHudError>()("GamingHudError", {
  cause: Schema.Defect(),
}) {}

export const installGamingHud = Effect.fn("desktop.ipc.installGamingHud")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const huds = new Map<number, ReturnType<typeof createGamingHud>>();
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_GAMING_HUD_CHANNEL,
      payload: GamingHudState,
      result: Schema.Void,
      handler: (state, event) =>
        Effect.tryPromise({
          try: async () => {
            if (!event) return;
            const contents = Electron.webContents.fromId(event.sender.id);
            if (!contents) return;
            const owner = Electron.BrowserWindow.fromWebContents(contents);
            if (!owner || owner.isDestroyed()) return;
            let hud = huds.get(owner.id);
            if (!hud && state.enabled) {
              hud = createGamingHud(owner);
              huds.set(owner.id, hud);
              owner.once("closed", () => huds.delete(owner.id));
            }
            await hud?.update(state);
          },
          catch: (cause) => new GamingHudError({ cause }),
        }),
    }),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const hud of huds.values()) hud.dispose();
      huds.clear();
    }),
  );
});
