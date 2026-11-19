import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { StreamingVoiceInputSession } from "../features/voice-input/streamingVoiceInputSession";
import { createVoiceInputTarget } from "../features/voice-input/voiceInputSession";

const mocks = vi.hoisted(() => ({
  appState: { currentState: "active" },
  requestMultiple: vi.fn(),
  native: {
    getDictationSettings: () => ({
      configured: true,
      bluetooth: true,
      architecture: 2,
      ready: true,
    }),
    startDictation: vi.fn(async () => {}),
    stopDictation: vi.fn(async () => []),
    cancelDictation: vi.fn(async () => {}),
    configureDictation: vi.fn(async () => {}),
    addListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => mocks.native }));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  AppState: mocks.appState,
  Platform: { Version: 35 },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: "microphone", BLUETOOTH_CONNECT: "bluetooth" },
    RESULTS: { GRANTED: "granted" },
    requestMultiple: mocks.requestMultiple,
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.appState.currentState = "active";
});

describe("Android local dictation permissions", () => {
  it("connects after the runtime permission activity backgrounds and resumes T3", async () => {
    const { getLocalDictationBackend } = await import("./localDictation.android");
    const backend = getLocalDictationBackend()!;
    const session = new StreamingVoiceInputSession(backend, vi.fn());
    const target = createVoiceInputTarget("draft", () => "", vi.fn(), { start: 0, end: 0 });
    mocks.requestMultiple.mockImplementationOnce(async () => {
      expect(backend.isRequestingPermission?.()).toBe(true);
      mocks.appState.currentState = "background";
      session.appMovedToBackground();
      mocks.appState.currentState = "active";
      return { microphone: "granted", bluetooth: "granted" };
    });
    await session.start(target);
    expect(session.currentState.phase).toBe("recording");
    expect(mocks.native.startDictation).toHaveBeenCalledOnce();
    expect(backend.isRequestingPermission?.()).toBe(false);
    await session.stop();
  });

  it("does not start capture if the app stays in the background after granting permission", async () => {
    const { getLocalDictationBackend } = await import("./localDictation.android");
    const backend = getLocalDictationBackend()!;
    mocks.requestMultiple.mockImplementationOnce(async () => {
      mocks.appState.currentState = "background";
      return { microphone: "granted", bluetooth: "granted" };
    });
    await expect(
      backend.start(
        { phrase: vi.fn(), ended: vi.fn(), failed: vi.fn(), preparing: vi.fn() },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Return to T3");
    expect(mocks.native.startDictation).not.toHaveBeenCalled();
    expect(backend.isRequestingPermission?.()).toBe(false);
  });

  it("clears permission state after an Android permission request fails", async () => {
    const { getLocalDictationBackend } = await import("./localDictation.android");
    const backend = getLocalDictationBackend()!;
    mocks.requestMultiple.mockRejectedValueOnce(new Error("permission activity failed"));
    await expect(
      backend.start(
        { phrase: vi.fn(), ended: vi.fn(), failed: vi.fn(), preparing: vi.fn() },
        new AbortController().signal,
      ),
    ).rejects.toThrow("permission activity failed");
    expect(backend.isRequestingPermission?.()).toBe(false);
    expect(mocks.native.startDictation).not.toHaveBeenCalled();
  });
});
