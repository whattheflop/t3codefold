import { EnvironmentId, type DeviceDetail, type DeviceSummary } from "@t3tools/contracts";
import type { DeviceHubAccess } from "@t3tools/client-runtime/device/hub-access";
import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useDeviceControls, type DeviceControls } from "./useDeviceControls";

type Result = { _tag: "Success"; value: DeviceDetail } | { _tag: "Failure"; cause: unknown };
const { read, action, subscribe, refreshAccess } = vi.hoisted(() => ({
  read: vi.fn<() => Promise<Result>>(),
  action: vi.fn<() => Promise<Result>>(),
  subscribe:
    vi.fn<
      (
        _target: unknown,
        onChange: (app: { id: string } | null) => void,
        onUnauthorized?: () => void,
      ) => () => void
    >(),
  refreshAccess: vi.fn(),
}));
vi.mock("~/state/device", () => ({
  deviceEnvironment: { detail: "detail", action: "action" },
  refreshDeviceHubAccess: refreshAccess,
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "detail" ? read : action),
}));
vi.mock("~/state/query", () => ({ formatEnvironmentQueryError: () => "Device action failed" }));
vi.mock("./deviceHubApi", () => ({ subscribeDeviceForeground: subscribe }));

const device: DeviceSummary = {
  hostId: "remote",
  id: "phone",
  name: "Phone",
  platform: "ios",
  version: "iOS",
  booted: true,
  physical: false,
};
const snapshot = (appearance: "light" | "dark"): Result => ({
  _tag: "Success",
  value: {
    hostId: "remote",
    deviceId: "phone",
    settings: { appearance },
    foregroundApp: null,
    readAt: "2026-09-20T00:00:00Z",
  },
});
function deferred() {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let renderer: ReactTestRenderer | undefined;
let controls: DeviceControls;
function Probe({
  visible,
  access = null,
  watchForeground = true,
  environmentId = EnvironmentId.make("environment"),
  target = device,
}: {
  visible: boolean;
  access?: DeviceHubAccess | null;
  watchForeground?: boolean;
  environmentId?: EnvironmentId;
  target?: DeviceSummary;
}) {
  const next = useDeviceControls({
    environmentId,
    device: target,
    access,
    visible,
    watchForeground,
  });
  useEffect(() => {
    controls = next;
  }, [next]);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  read.mockReset();
  action.mockReset();
  subscribe.mockReset();
  refreshAccess.mockReset();
  subscribe.mockReturnValue(() => {});
  read.mockResolvedValue(snapshot("light"));
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => {
    renderer = create(<Probe visible />);
  });
}

it("serializes rapid actions and retains confirmed settings while pending or after failure", async () => {
  await mount();
  const response = deferred();
  action.mockReturnValueOnce(response.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = controls.act({ type: "setAppearance", value: "dark" });
    await controls.act({ type: "setAppearance", value: "light" });
  });
  expect(action).toHaveBeenCalledOnce();
  expect(controls.disabled).toBe(true);
  expect(controls.detail?.settings.appearance).toBe("light");
  await act(async () => {
    response.resolve(snapshot("dark"));
    await pending;
  });
  expect(controls.detail?.settings.appearance).toBe("dark");
  action.mockResolvedValueOnce({ _tag: "Failure", cause: "offline" });
  await act(async () => controls.act({ type: "setAppearance", value: "light" }));
  expect(controls.detail?.settings.appearance).toBe("dark");
  expect(controls.error).toBe("Device action failed");
  expect(controls.disabled).toBe(false);
});

it("serializes host actions across hide/reopen and discards detached results", async () => {
  await mount();
  const response = deferred();
  action.mockReturnValueOnce(response.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = controls.act({ type: "setAppearance", value: "dark" });
  });
  await act(async () => renderer!.update(<Probe visible={false} />));
  expect(controls.disabled).toBe(true);
  await act(async () => renderer!.update(<Probe visible />));
  await act(async () => controls.act({ type: "setAppearance", value: "light" }));
  expect(action).toHaveBeenCalledOnce();
  expect(controls.disabled).toBe(true);
  const confirmed = deferred();
  read.mockReturnValueOnce(confirmed.promise);
  await act(async () => {
    response.resolve(snapshot("dark"));
    await response.promise;
  });
  expect(controls.detail?.settings.appearance).toBe("light");
  expect(controls.disabled).toBe(true);
  await act(async () => {
    confirmed.resolve(snapshot("dark"));
    await pending;
  });
  expect(controls.detail?.settings.appearance).toBe("dark");
  expect(controls.disabled).toBe(false);
  action.mockResolvedValueOnce(snapshot("dark"));
  await act(async () => controls.act({ type: "setAppearance", value: "dark" }));
  expect(action).toHaveBeenCalledTimes(2);
  expect(controls.detail?.settings.appearance).toBe("dark");
});

it("keeps actions disabled when settings cannot be confirmed after a detached command", async () => {
  await mount();
  const response = deferred();
  action.mockReturnValueOnce(response.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = controls.act({ type: "setAppearance", value: "dark" });
  });
  await act(async () => renderer!.update(<Probe visible={false} />));
  await act(async () => renderer!.update(<Probe visible />));
  read.mockResolvedValueOnce({ _tag: "Failure", cause: "offline" });
  await act(async () => {
    response.resolve(snapshot("dark"));
    await pending;
  });
  expect(controls.detail).toBeNull();
  expect(controls.disabled).toBe(true);
  expect(controls.error).toBe("Device action failed");
  await act(async () => controls.act({ type: "setAppearance", value: "light" }));
  expect(action).toHaveBeenCalledOnce();
  await act(async () => renderer!.update(<Probe visible={false} />));
  await act(async () => renderer!.update(<Probe visible />));
  expect(controls.disabled).toBe(false);
  expect(controls.error).toBeNull();
});

it("disables stale settings after a failed reopen read and recovers on a successful read", async () => {
  await mount();
  await act(async () => renderer!.update(<Probe visible={false} />));
  read.mockResolvedValueOnce({ _tag: "Failure", cause: "offline" });
  await act(async () => renderer!.update(<Probe visible />));
  expect(controls.detail).toBeNull();
  expect(controls.disabled).toBe(true);
  expect(controls.error).toBe("Device action failed");
  await act(async () => controls.act({ type: "setAppearance", value: "dark" }));
  expect(action).not.toHaveBeenCalled();
  await act(async () => renderer!.update(<Probe visible={false} />));
  await act(async () => renderer!.update(<Probe visible />));
  expect(controls.detail?.settings.appearance).toBe("light");
  expect(controls.disabled).toBe(false);
  expect(controls.error).toBeNull();
});

it("does not let an older refresh overwrite a newer confirmed action", async () => {
  await mount();
  await act(async () => renderer!.update(<Probe visible={false} />));
  const refresh = deferred();
  read.mockReturnValueOnce(refresh.promise);
  await act(async () => renderer!.update(<Probe visible />));
  action.mockResolvedValueOnce(snapshot("dark"));
  await act(async () => controls.act({ type: "setAppearance", value: "dark" }));
  await act(async () => {
    refresh.resolve(snapshot("light"));
    await refresh.promise;
  });
  expect(controls.detail?.settings.appearance).toBe("dark");
});

it.each(["hidden", "access renewed"] as const)(
  "uses the detail snapshot until a new foreground event after the subscription is %s",
  async (restart) => {
    const access: DeviceHubAccess = {
      httpBase: "https://remote.test/api/device-hub",
      wsBase: "wss://remote.test/api/device-hub",
      query: {},
      credentials: false,
    };
    const detail = snapshot("light");
    if (detail._tag !== "Success") throw new Error("Expected a successful snapshot");
    read.mockResolvedValue({
      ...detail,
      value: { ...detail.value, foregroundApp: { id: "snapshot.app" } },
    });
    await act(async () => {
      renderer = create(<Probe visible access={access} />);
    });
    const oldEvent = subscribe.mock.calls[0]![1];
    await act(async () => oldEvent({ id: "previous.live.app" }));
    expect(controls.foregroundApp?.id).toBe("previous.live.app");
    if (restart === "hidden") {
      await act(async () => renderer!.update(<Probe visible={false} access={access} />));
      await act(async () => renderer!.update(<Probe visible access={access} />));
    } else {
      await act(async () =>
        renderer!.update(<Probe visible access={{ ...access, query: { ticket: "renewed" } }} />),
      );
    }
    expect(controls.foregroundApp?.id).toBe("snapshot.app");
    await act(async () => oldEvent({ id: "late.previous.app" }));
    expect(controls.foregroundApp?.id).toBe("snapshot.app");
    const newEvent = subscribe.mock.calls[1]![1];
    await act(async () => newEvent({ id: "current.live.app" }));
    expect(controls.foregroundApp?.id).toBe("current.live.app");
  },
);

const access: DeviceHubAccess = {
  httpBase: "https://remote.test/api/device-hub",
  wsBase: "wss://remote.test/api/device-hub",
  query: { hostId: "remote", wsTicket: "old-ticket" },
  credentials: false,
};

it("only observes foreground apps while Tools and the device are visible", async () => {
  const stop = vi.fn();
  subscribe.mockReturnValue(stop);
  await act(async () => {
    renderer = create(<Probe visible access={access} watchForeground={false} />);
  });
  expect(subscribe).not.toHaveBeenCalled();
  await act(async () => renderer!.update(<Probe visible access={access} watchForeground />));
  expect(subscribe).toHaveBeenCalledOnce();
  const onChange = subscribe.mock.calls[0]![1];
  await act(() => onChange({ id: "current.app" }));
  expect(controls.foregroundApp).toEqual({ id: "current.app" });
  await act(async () =>
    renderer!.update(<Probe visible access={access} watchForeground={false} />),
  );
  expect(stop).toHaveBeenCalledOnce();
  await act(() => onChange({ id: "stale.app" }));
  expect(controls.foregroundApp).toBeNull();
  await act(async () =>
    renderer!.update(<Probe visible={false} access={access} watchForeground />),
  );
  expect(subscribe).toHaveBeenCalledOnce();
});

it("renews the current environment's foreground access and ignores detached callbacks", async () => {
  const stop = vi.fn();
  subscribe.mockReturnValue(stop);
  await act(async () => {
    renderer = create(<Probe visible access={access} />);
  });
  const unauthorized = subscribe.mock.calls[0]![2]!;
  await act(() => unauthorized());
  expect(refreshAccess).toHaveBeenCalledWith(EnvironmentId.make("environment"));
  const renewedAccess = { ...access, query: { hostId: "remote", wsTicket: "new-ticket" } };
  await act(async () => renderer!.update(<Probe visible access={renewedAccess} />));
  expect(stop).toHaveBeenCalledOnce();
  expect(subscribe).toHaveBeenCalledTimes(2);
  await act(() => unauthorized());
  expect(refreshAccess).toHaveBeenCalledOnce();
  const currentUnauthorized = subscribe.mock.calls[1]![2]!;
  await act(async () => renderer!.update(<Probe visible={false} access={renewedAccess} />));
  await act(() => currentUnauthorized());
  expect(refreshAccess).toHaveBeenCalledOnce();
});

it("detaches foreground callbacks when the environment changes", async () => {
  await act(async () => {
    renderer = create(<Probe visible access={access} />);
  });
  const onChange = subscribe.mock.calls[0]![1];
  const unauthorized = subscribe.mock.calls[0]![2]!;
  await act(() => onChange({ id: "previous.app" }));
  const nextEnvironment = EnvironmentId.make("next-environment");
  await act(async () =>
    renderer!.update(<Probe visible access={access} environmentId={nextEnvironment} />),
  );
  await act(() => {
    onChange({ id: "stale.app" });
    unauthorized();
  });
  expect(controls.foregroundApp).toBeNull();
  expect(refreshAccess).not.toHaveBeenCalled();
  expect(subscribe).toHaveBeenCalledTimes(2);
  await act(() => subscribe.mock.calls[1]![2]!());
  expect(refreshAccess).toHaveBeenCalledWith(nextEnvironment);
});

it("detaches foreground callbacks when switching hosts with the same device id", async () => {
  await act(async () => {
    renderer = create(<Probe visible access={access} />);
  });
  const onChange = subscribe.mock.calls[0]![1];
  await act(() => onChange({ id: "previous.app" }));
  await act(async () =>
    renderer!.update(<Probe visible access={access} target={{ ...device, hostId: "other" }} />),
  );
  await act(() => onChange({ id: "stale.app" }));
  expect(controls.foregroundApp).toBeNull();
  expect(subscribe).toHaveBeenCalledTimes(2);
});
