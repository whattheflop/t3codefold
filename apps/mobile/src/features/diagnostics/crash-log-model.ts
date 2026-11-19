export interface UpdatesLogEntryLike {
  readonly timestamp: number;
  readonly message: string;
  readonly code: string;
  readonly level: string;
}

export interface StartupCrashRecord {
  readonly timestamp: number;
  readonly description: string;
  readonly frames: ReadonlyArray<string>;
  readonly detail: string;
}

export async function readCrashRecords(
  sources: {
    readonly updates: (() => Promise<ReadonlyArray<UpdatesLogEntryLike>>) | null;
    readonly native: (() => Promise<ReadonlyArray<StartupCrashRecord>>) | null;
  },
  since: number,
): Promise<ReadonlyArray<StartupCrashRecord>> {
  const reads = [
    ...(sources.updates ? [sources.updates().then(parseStartupCrashRecords)] : []),
    ...(sources.native ? [sources.native()] : []),
  ];
  const results = await Promise.allSettled(reads);
  const records = results.filter((result) => result.status === "fulfilled");
  if (records.length === 0) {
    const failure = results.find((result) => result.status === "rejected");
    throw failure?.reason ?? new Error("No crash log is available.");
  }
  return records
    .flatMap((result) => result.value)
    .filter((record) => record.timestamp >= since)
    .sort((left, right) => right.timestamp - left.timestamp);
}

const FATAL_PREFIX = "ErrorRecovery fatal exception: ";
const DESCRIPTION_PREFIX = "Description: ";
const UNHANDLED_PREFIX = "Unhandled JS Exception: ";

export function parseStartupCrashRecords(
  entries: ReadonlyArray<UpdatesLogEntryLike>,
): ReadonlyArray<StartupCrashRecord> {
  const records: StartupCrashRecord[] = [];
  for (const entry of entries) {
    if (entry.code !== "JSRuntimeError" || !entry.message.startsWith(FATAL_PREFIX)) continue;
    const body = entry.message.slice(FATAL_PREFIX.length);
    const lines = body.split("\n");
    const descriptionLine = lines.find((line) => line.startsWith(DESCRIPTION_PREFIX));
    if (descriptionLine === undefined) continue;
    let description = descriptionLine.slice(DESCRIPTION_PREFIX.length).trim();
    if (description.startsWith(UNHANDLED_PREFIX)) {
      description = description.slice(UNHANDLED_PREFIX.length);
    }
    const frames = lines
      .map((line) => line.trim())
      .filter((line) => line.startsWith("at "))
      .map(compactFrame);
    records.push({ timestamp: entry.timestamp, description, frames, detail: body.trim() });
  }
  return records.sort((left, right) => right.timestamp - left.timestamp);
}

function compactFrame(line: string): string {
  const match = /^at (.+?) \((.*)\)$/.exec(line);
  if (!match) return line.slice("at ".length);
  const [, name = "", location = ""] = match;
  const file = location.slice(location.lastIndexOf("/") + 1);
  return location === "<anonymous>" ? name : `${name} (${file})`;
}

export function formatStartupCrashReport(
  records: ReadonlyArray<StartupCrashRecord>,
  app: { readonly version: string; readonly build: string },
): string {
  const header = `T3 Code ${app.version} (${app.build})`;
  if (records.length === 0) return `${header}\nNo crashes or recording failures recorded.`;
  return [
    header,
    ...records.map(
      (record) => `\n--- ${new Date(record.timestamp).toISOString()} ---\n${record.detail}`,
    ),
  ].join("\n");
}
