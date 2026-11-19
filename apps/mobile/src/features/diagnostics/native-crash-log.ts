import { requireOptionalNativeModule } from "expo";

import type { StartupCrashRecord } from "./crash-log-model";

const native = requireOptionalNativeModule<{
  getLocalCrashDiagnostics?: () => Promise<ReadonlyArray<Omit<StartupCrashRecord, "frames">>>;
}>("T3VoiceAudio");

export const nativeCrashLogAvailable = typeof native?.getLocalCrashDiagnostics === "function";

export async function readNativeCrashRecords(): Promise<ReadonlyArray<StartupCrashRecord>> {
  return (
    (await native?.getLocalCrashDiagnostics?.())?.map((record) => ({
      ...record,
      frames: [],
    })) ?? []
  );
}
