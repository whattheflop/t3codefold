import * as Schema from "effect/Schema";
const MaybeText = Schema.optional(Schema.NullOr(Schema.String));
const Strings = Schema.Array(Schema.String);
export const Hello = Schema.Struct({
  generation: Schema.Literal(1),
  core: Schema.Struct({ id: Schema.NonEmptyString, name: Schema.String }),
  methods: Strings,
  features: Strings,
});
const Status = Schema.Struct({ state: Schema.String, app: MaybeText, kind: MaybeText });
const Terminal = Schema.Struct({
  address: Schema.NonEmptyString,
  name: MaybeText,
  parent: MaybeText,
  cwd: Schema.String,
  state: Schema.String,
  reason: MaybeText,
  status: Schema.optional(Schema.NullOr(Status)),
  labels: Schema.Record(Schema.String, Schema.String),
  foreground: Schema.optional(
    Schema.NullOr(Schema.Struct({ name: Schema.String, cwd: MaybeText })),
  ),
});
export const Fleet = Schema.Struct({ terminals: Schema.Array(Terminal) });
export const FilePage = Schema.Struct({
  text: Schema.String,
  first: Schema.Number,
  last: Schema.Number,
  lines: Schema.Number,
});
export const SendResult = Schema.Struct({
  turn: Schema.Number,
  started: Schema.optional(Schema.NullOr(Schema.Boolean)),
});
export const CoreDocument = Schema.Struct({ value: Schema.Unknown, version: Schema.Number });
export const ExecResult = Schema.Struct({
  stdout: Schema.String,
  code: Schema.optional(Schema.NullOr(Schema.Number)),
  timed_out: Schema.Boolean,
  truncated: Schema.Boolean,
});
const Action = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  permission: Schema.String,
  targetKind: Schema.String,
  method: Schema.Literals(["POST", "PUT", "DELETE"]),
  path: Schema.String,
  input: Schema.Array(
    Schema.Struct({ name: Schema.String, label: Schema.String, required: Schema.Boolean }),
  ),
});
const ResourceKind = Schema.Struct({
  kind: Schema.String,
  label: Schema.String,
  fields: Strings,
  path: Schema.String,
  resultKey: Schema.String,
});
export const Module = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  schemaVersion: Schema.Literal(1),
  baseUrl: Schema.String,
  tokenPath: MaybeText,
  resources: Schema.Array(ResourceKind),
  actions: Schema.Array(Action),
});
export type CoreHello = typeof Hello.Type;
export type CoreTerminal = typeof Terminal.Type;
export type CoreModule = typeof Module.Type;
export interface CoreAgent {
  readonly id: string;
  readonly label: string;
  readonly terminal: string | null;
  readonly parentId: string | null;
  readonly role: string | null;
  /** The Herdr tab the terminal sits in, when the setup labels one. */
  readonly tab: string | null;
  readonly cwd: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly conversationId: string | null;
  readonly generation: string;
  readonly status: string;
  readonly processState: string;
  readonly capabilities: readonly string[];
}
export interface CorePart {
  readonly id: string;
  readonly kind: "text" | "tool" | "notice" | "interaction";
  readonly text: string;
  readonly name?: string;
  readonly state?: string;
  readonly callId?: string;
  readonly output?: string;
}
export interface CoreItem {
  readonly id: string;
  readonly sequence: number;
  readonly revision: number;
  /** Provider-recorded ISO time, when the transcript row has one. */
  readonly at?: string;
  readonly role: "user" | "assistant" | "system" | "agent";
  readonly source: string;
  readonly parts: readonly CorePart[];
}
export interface CoreResource {
  readonly id: string;
  readonly revision: string;
  readonly fields: Readonly<Record<string, unknown>>;
}
export interface CoreReceipt {
  readonly commandId: string;
  readonly state: "accepted" | "queued" | "delivered" | "completed" | "unknown" | "rejected";
}
export interface CorePreparedAction {
  readonly preparationId: string;
  readonly summary: string;
  readonly payload: string;
  readonly payloadHash: string;
  readonly expiresAt: number;
}
export function mergeCoreItems(previous: readonly CoreItem[], incoming: readonly CoreItem[]) {
  const items = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) {
    const old = items.get(item.id);
    if (!old || item.revision > old.revision) items.set(item.id, item);
  }
  return [...items.values()].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}
export function terminalAgents(terminals: readonly CoreTerminal[]): readonly CoreAgent[] {
  return terminals.map((terminal) => ({
    id: terminal.address,
    label: terminal.name ?? terminal.address,
    terminal: terminal.address,
    parentId: terminal.parent ?? null,
    role: null,
    tab: null,
    cwd: terminal.cwd,
    provider: terminal.status?.app ?? null,
    model: null,
    conversationId: null,
    generation: "unknown",
    status: terminal.reason ?? terminal.status?.state ?? terminal.state,
    processState: terminal.state,
    capabilities: [],
  }));
}
