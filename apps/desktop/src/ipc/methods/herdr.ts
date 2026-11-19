import {
  DesktopHerdrAttachInput,
  DesktopHerdrAttachOpen,
  DesktopHerdrRequest,
} from "@t3tools/contracts";
import * as Electron from "electron";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as DesktopHerdr from "../../herdr/DesktopHerdr.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export const herdrRequest = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.HERDR_REQUEST_CHANNEL,
  payload: DesktopHerdrRequest,
  result: Schema.Unknown,
  handler: Effect.fn("desktop.ipc.herdr.request")(function* (input) {
    const herdr = yield* DesktopHerdr.DesktopHerdr;
    return yield* herdr.request(input);
  }),
});

// Renderers whose reload or exit already ends their streams.
const releasedOwners = new Set<number>();

export const herdrAttachOpen = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.HERDR_ATTACH_OPEN_CHANNEL,
  payload: DesktopHerdrAttachOpen,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.herdr.attachOpen")(function* (input, event) {
    const herdr = yield* DesktopHerdr.DesktopHerdr;
    const contents = event ? Electron.webContents.fromId(event.sender.id) : undefined;
    if (!contents || contents.isDestroyed()) return;
    const owner = contents.id;
    if (!releasedOwners.has(owner)) {
      releasedOwners.add(owner);
      const release = () => herdr.attachRelease(owner);
      contents.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) release();
      });
      contents.once("destroyed", () => {
        releasedOwners.delete(owner);
        release();
      });
    }
    yield* herdr.attachOpen(input, owner, (attachEvent) => {
      if (!contents.isDestroyed())
        contents.send(IpcChannels.HERDR_ATTACH_EVENT_CHANNEL, attachEvent);
    });
  }),
});

export const herdrAttachInput = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.HERDR_ATTACH_INPUT_CHANNEL,
  payload: DesktopHerdrAttachInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.herdr.attachInput")(function* (input) {
    const herdr = yield* DesktopHerdr.DesktopHerdr;
    herdr.attachInput(input);
  }),
});
