// @effect-diagnostics globalDate:off - Client-side staged action expiry is checked outside an Effect runtime.
import * as Schema from "effect/Schema";
import { HerdrClient, type CoreTransport } from "./client.ts";
import {
  Fleet,
  FilePage,
  SendResult,
  CoreDocument,
  Module,
  terminalAgents,
  type CoreAgent,
  type CoreHello,
  type CoreItem,
  type CoreModule,
  type CoreResource,
  type CorePreparedAction,
  type CoreReceipt,
} from "./protocol.ts";
import type { HerdrDestination } from "./destinations.ts";
import { appendTranscript, type TranscriptProvider } from "./transcript.ts";
import { moduleRequest } from "./serviceModule.ts";
import { isSessionId, resolveTranscripts, transcriptProvider } from "./discovery.ts";
// Labels written by herd-style launchers; used only when a setup publishes no mapping.
const HERD_MAPPING: Record<string, string> = {
  name: "herd.name",
  role: "herd.role",
  parent: "herd.token.parent",
  session: "herd.session",
  tab: "herd.tab",
};
const DISCOVERY_RETRY_MS = 60_000;
const decodeFleet = Schema.decodeUnknownSync(Fleet);
const decodeFile = Schema.decodeUnknownSync(FilePage);
const decodeSend = Schema.decodeUnknownSync(SendResult);
const decodeDocument = Schema.decodeUnknownSync(CoreDocument);
const decodeModule = Schema.decodeUnknownSync(Module);
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export interface HerdrWorkspaceState {
  connection: "disconnected" | "connecting" | "connected" | "stale";
  hello: CoreHello | null;
  agents: readonly CoreAgent[];
  modules: readonly CoreModule[];
  unsupportedModules: number;
  selected: CoreAgent | null;
  items: readonly CoreItem[];
  history: "unavailable" | "loading" | "ready";
  before: string | null;
  cursor: string | null;
  resources: readonly CoreResource[];
  resourceNext: string | null;
  error: string | null;
  receipt: CoreReceipt | null;
  prepared: CorePreparedAction | null;
}
const initial = (): HerdrWorkspaceState => ({
  connection: "disconnected",
  hello: null,
  agents: [],
  modules: [],
  unsupportedModules: 0,
  selected: null,
  items: [],
  history: "unavailable",
  before: null,
  cursor: null,
  resources: [],
  resourceNext: null,
  error: null,
  receipt: null,
  prepared: null,
});
interface TranscriptBinding {
  readonly path: string;
  readonly provider: TranscriptProvider;
  readonly on?: string;
  readonly discovered?: boolean;
}
export class HerdrWorkspace {
  private state = initial();
  private listeners = new Set<() => void>();
  private client: HerdrClient | null = null;
  private readOnly = true;
  private epoch = 0;
  private selection = 0;
  private resourceSelection = 0;
  private bindings = new Map<string, TranscriptBinding>();
  private mapping: Record<string, string> = HERD_MAPPING;
  private probed = new Map<string, number>();
  private lines = new Map<string, number>();
  private records = new Map<string, { line: number; value: unknown }[]>();
  private preparedOperation: {
    module: CoreModule;
    method: "POST" | "PUT" | "DELETE";
    path: string;
    body: Record<string, unknown>;
  } | null = null;
  private unknownDelivery = false;
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<HerdrWorkspaceState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  supports(method: string) {
    return this.client?.supports(method) ?? false;
  }
  permits(_scope: string) {
    return !this.readOnly && this.state.connection === "connected" && !this.unknownDelivery;
  }
  private current() {
    if (!this.client || this.state.connection !== "connected")
      throw new Error("Connect to the selected Core first.");
    return this.client;
  }
  async connect(destination: HerdrDestination, transport: CoreTransport) {
    const previous = this.state.selected?.id;
    this.close();
    const epoch = ++this.epoch;
    const client = new HerdrClient(transport);
    this.client = client;
    this.readOnly = destination.readOnly;
    this.bindings.clear();
    this.probed.clear();
    this.mapping = HERD_MAPPING;
    this.update({ connection: "connecting", error: null, prepared: null });
    try {
      const hello = await client.negotiate(destination.coreId);
      if (epoch !== this.epoch) return null;
      this.update({ connection: "connected", hello });
      if (client.supports("doc.get")) {
        const doc = decodeDocument(await client.request("doc.get", { name: "t3-client" }));
        const profile = object(doc.value);
        const mapping = object(profile?.metadataMapping);
        this.mapping = mapping
          ? Object.fromEntries(
              Object.entries(mapping).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : HERD_MAPPING;
        const modules: CoreModule[] = [];
        let unsupportedModules = 0;
        for (const raw of Array.isArray(profile?.modules) ? profile.modules : []) {
          try {
            modules.push(decodeModule(raw));
          } catch {
            unsupportedModules++;
          }
        }
        for (const raw of Array.isArray(profile?.transcripts) ? profile.transcripts : []) {
          const binding = object(raw);
          if (
            typeof binding?.terminal === "string" &&
            typeof binding.path === "string" &&
            (binding.provider === "claude" || binding.provider === "codex")
          ) {
            this.bindings.set(binding.terminal, {
              path: binding.path,
              provider: binding.provider,
              ...(typeof binding.on === "string" ? { on: binding.on } : {}),
            });
          }
        }
        if (epoch !== this.epoch) return null;
        this.update({ modules, unsupportedModules });
      }
      for (const [terminal, binding] of Object.entries(destination.bindings ?? {}))
        this.bindings.set(terminal, binding);
      await this.refresh();
      if (epoch !== this.epoch) return null;
      if (previous)
        await this.select(this.state.agents.find((agent) => agent.id === previous) ?? null);
      return hello.core.id;
    } catch (error) {
      if (epoch === this.epoch)
        this.update({
          connection: "stale",
          error: error instanceof Error ? error.message : "Core connection failed",
        });
      return null;
    }
  }
  async refresh() {
    const client = this.current();
    const terminals = decodeFleet(await client.request("terminal.list", { all: true })).terminals;
    if (this.client !== client) return;
    const field = (terminal: (typeof terminals)[number], key: string) =>
      this.mapping[key] ? (terminal.labels[this.mapping[key]!] ?? null) : null;
    await this.discoverTranscripts(client, terminals, field);
    if (this.client !== client) return;
    const agents = terminalAgents(terminals).map((agent, index) => {
      const terminal = terminals[index]!;
      const provider = terminal.foreground?.name ?? agent.provider;
      return {
        ...agent,
        label: field(terminal, "name") ?? agent.label,
        parentId: this.parentAddress(terminals, field(terminal, "parent")) ?? agent.parentId,
        role: field(terminal, "role"),
        tab: field(terminal, "tab"),
        generation: field(terminal, "session") ?? "unknown",
        provider,
        model: field(terminal, "model"),
        capabilities:
          terminal.state === "live" && (!!terminal.status?.app || this.bindings.has(agent.id))
            ? ["send", "interrupt"]
            : [],
        conversationId: this.bindings.has(agent.id) ? agent.id : null,
      };
    });
    this.update({ agents });
    if (this.state.selected) {
      const selected = agents.find((agent) => agent.id === this.state.selected?.id);
      if (
        !selected ||
        selected.generation !== this.state.selected.generation ||
        (selected.conversationId && this.state.history === "unavailable")
      )
        await this.select(selected ?? null);
      else this.update({ selected });
    }
  }
  // Parent labels name the parent agent; the fleet tree links by terminal address.
  private parentAddress(
    terminals: readonly { address: string; labels: Record<string, string> }[],
    parent: string | null,
  ) {
    if (!parent) return null;
    const key = this.mapping.name;
    return (
      terminals.find((t) => t.address === parent || (key && t.labels[key] === parent))?.address ??
      parent
    );
  }
  private async discoverTranscripts(
    client: HerdrClient,
    terminals: readonly (typeof Fleet.Type)["terminals"][number][],
    field: (terminal: (typeof Fleet.Type)["terminals"][number], key: string) => string | null,
  ) {
    const now = Date.now();
    const pending = new Map<string, { address: string; provider: "claude" | "codex" }>();
    for (const terminal of terminals) {
      const existing = this.bindings.get(terminal.address);
      const session = field(terminal, "session");
      const provider = transcriptProvider(terminal.foreground?.name ?? terminal.status?.app);
      if (existing && !existing.discovered) continue;
      if (!isSessionId(session) || !provider) continue;
      if (existing?.path.includes(session)) continue;
      if (now - (this.probed.get(session) ?? -Infinity) < DISCOVERY_RETRY_MS) continue;
      pending.set(session, { address: terminal.address, provider });
    }
    if (pending.size === 0) return;
    for (const session of pending.keys()) this.probed.set(session, now);
    let found: ReadonlyMap<string, string>;
    try {
      found = await resolveTranscripts(
        client,
        [...pending].map(([id, { provider }]) => ({ id, provider })),
      );
    } catch {
      return;
    }
    for (const [session, path] of found) {
      const target = pending.get(session);
      if (!target) continue;
      this.bindings.set(target.address, { path, provider: target.provider, discovered: true });
      this.lines.delete(target.address);
      this.records.delete(target.address);
    }
  }
  transcriptSource(terminal: string) {
    return this.bindings.get(terminal) ?? null;
  }
  async bindTranscript(path: string, provider: TranscriptProvider) {
    const agent = this.state.selected;
    if (!agent) throw new Error("Select a terminal first.");
    if (!path.startsWith("/"))
      throw new Error("Enter an absolute transcript path on the Core host.");
    this.bindings.set(agent.id, { path, provider });
    this.lines.delete(agent.id);
    this.records.delete(agent.id);
    await this.select({ ...agent, conversationId: agent.id, capabilities: ["send", "interrupt"] });
  }
  async select(agent: CoreAgent | null) {
    ++this.selection;
    this.update({
      selected: agent,
      items: [],
      before: null,
      cursor: null,
      history: "unavailable",
      error: null,
      prepared: null,
    });
    this.preparedOperation = null;
    if (!agent || !this.bindings.has(agent.id)) return;
    this.lines.delete(agent.id);
    this.records.delete(agent.id);
    this.update({ history: "loading" });
    await this.syncHistory();
  }
  private async readTranscriptPage(older: boolean) {
    const client = this.current();
    const agent = this.state.selected;
    if (!agent) return;
    const binding = this.bindings.get(agent.id);
    if (!binding || !client.supports("file.read")) return;
    const selection = this.selection;
    const target = { path: binding.path, ...(binding.on ? { on: binding.on } : {}) };
    let offset = Math.max(1, this.lines.get(agent.id) ?? 1);
    let limit = 200;
    if (older) {
      const before = Number(this.state.before);
      if (!before) return;
      offset = Math.max(1, before - 200);
      limit = before - offset;
    } else if (!this.lines.has(agent.id)) {
      const head = decodeFile(
        await client.request("file.read", { ...target, offset: 1, limit: 0 }),
      );
      offset = Math.max(1, head.lines - 199);
    }
    const page = decodeFile(await client.request("file.read", { ...target, offset, limit }));
    if (this.client !== client || selection !== this.selection) return;
    if (!older && page.lines < (this.lines.get(agent.id) ?? 0)) {
      this.lines.delete(agent.id);
      this.records.delete(agent.id);
      this.update({
        items: [],
        history: "unavailable",
        error: "Transcript was replaced or truncated. Reopen this session to reload it.",
      });
      return;
    }
    const records = this.records.get(agent.id) ?? [];
    let invalidRecords = 0;
    const additions = page.text.split("\n").flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        return [{ line: page.first + index, value: JSON.parse(line) as unknown }];
      } catch {
        invalidRecords++;
        return [];
      }
    });
    const all = [
      ...new Map([...records, ...additions].map((record) => [record.line, record])).values(),
    ].sort((a, b) => a.line - b.line);
    this.records.set(agent.id, all);
    this.lines.set(agent.id, Math.max(this.lines.get(agent.id) ?? 0, page.last));
    const items = appendTranscript([], binding.path, binding.provider, all);
    const before =
      older || records.length === 0 ? (offset > 1 ? String(offset) : null) : this.state.before;
    this.update({
      items,
      before,
      cursor: String(this.lines.get(agent.id)),
      history: "ready",
      ...(invalidRecords
        ? { error: "Some provider records could not be decoded. This history is incomplete." }
        : {}),
    });
  }
  async syncHistory() {
    await this.readTranscriptPage(false);
  }
  async older() {
    await this.readTranscriptPage(true);
  }
  canSend() {
    return (
      this.state.connection === "connected" &&
      !!this.state.selected?.capabilities.includes("send") &&
      this.permits("session.control") &&
      this.supports("terminal.send")
    );
  }
  async send(text: string, commandId: string) {
    if (!text.trim() || !this.canSend())
      throw new Error("Sending is unavailable. Check read-only mode and unresolved deliveries.");
    const client = this.current();
    const agent = this.state.selected!;
    this.update({ receipt: { commandId, state: "accepted" } });
    try {
      const fresh = await client.request("terminal.get", { terminal: agent.id });
      const record = object(fresh);
      const status = object(record?.status)?.state;
      decodeSend(
        await client.request(
          "terminal.send",
          {
            terminal: agent.id,
            text,
            force: false,
            wait: false,
            ...(status === "idle" || status === "working" ? { if: status } : {}),
          },
          true,
        ),
      );
      const receipt = { commandId, state: "delivered" as const };
      this.update({ receipt });
      return receipt;
    } catch (error) {
      this.unknownDelivery = true;
      this.update({ receipt: { commandId, state: "unknown" } });
      throw error;
    }
  }
  acknowledgeUnknownDelivery() {
    this.unknownDelivery = false;
    this.update({ receipt: null, error: null });
  }
  async reconcile() {
    throw new Error(
      "Unmodified Core has no durable send receipts. Verify the transcript or terminal before sending again.",
    );
  }
  async interrupt(_commandId: string) {
    if (this.readOnly || this.state.connection !== "connected" || !this.state.selected)
      throw new Error("Interruption is unavailable.");
    return this.current().request(
      "terminal.interrupt",
      { terminal: this.state.selected.id, timeout: 5 },
      true,
    );
  }
  async resources(moduleId: string, kind: string, _more = false) {
    const client = this.current();
    const selection = ++this.resourceSelection;
    const module = this.state.modules.find((module) => module.id === moduleId);
    const descriptor = module?.resources.find((resource) => resource.kind === kind);
    if (!module || !descriptor) throw new Error("Resource module unavailable.");
    this.update({ resources: [], prepared: null });
    this.preparedOperation = null;
    const data = object(await moduleRequest(client, module, "GET", descriptor.path));
    const rows = data?.[descriptor.resultKey];
    if (!Array.isArray(rows))
      throw new Error("The service resource list has an unsupported format.");
    const resources = rows.slice(0, 100).flatMap((raw) => {
      const row = object(raw);
      if (!row) return [];
      const id = row.id ?? row.name;
      if (typeof id !== "string") return [];
      const fields = row;
      return [{ id, revision: String(row.revision ?? row.version ?? "unknown"), fields }];
    });
    if (this.client === client && selection === this.resourceSelection)
      this.update({ resources, resourceNext: null });
  }
  async prepare(
    moduleId: string,
    actionId: string,
    resource: CoreResource,
    input: Record<string, string>,
  ) {
    if (!this.permits("module.control"))
      throw new Error("This connection is read-only or has an unresolved delivery.");
    const module = this.state.modules.find((module) => module.id === moduleId);
    const action = module?.actions.find((action) => action.id === actionId);
    if (!module || !action) throw new Error("Action unavailable.");
    for (const field of action.input)
      if (field.required && !input[field.name]?.trim())
        throw new Error(`${field.label} is required.`);
    const resourceSelection = this.resourceSelection;
    const epoch = this.epoch;
    const operation = {
      module,
      method: action.method,
      path: action.path.replaceAll("{id}", encodeURIComponent(resource.id)),
      body: { ...input },
    };
    const payload = JSON.stringify(
      {
        method: operation.method,
        baseUrl: module.baseUrl,
        path: operation.path,
        body: operation.body,
      },
      null,
      2,
    );
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
    const payloadHash = [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (resourceSelection !== this.resourceSelection || epoch !== this.epoch) return;
    this.preparedOperation = operation;
    this.update({
      prepared: {
        preparationId: actionId,
        summary: action.label,
        payload,
        payloadHash,
        expiresAt: Date.now() + 120_000,
      },
    });
  }
  cancelPrepared() {
    this.preparedOperation = null;
    this.update({ prepared: null });
  }
  async execute(_commandId: string) {
    const operation = this.preparedOperation;
    if (
      !operation ||
      !this.state.prepared ||
      this.state.prepared.expiresAt <= Date.now() ||
      !this.permits("module.control")
    )
      throw new Error("Action unavailable or expired. Prepare it again.");
    this.cancelPrepared();
    try {
      return await moduleRequest(
        this.current(),
        operation.module,
        operation.method,
        operation.path,
        operation.body,
      );
    } catch (error) {
      this.unknownDelivery = true;
      this.update({ error: "The action may have run. Verify service state before repeating it." });
      throw error;
    }
  }
  close() {
    ++this.epoch;
    ++this.selection;
    ++this.resourceSelection;
    this.client?.close();
    this.client = null;
    this.preparedOperation = null;
    this.update({ connection: "disconnected", prepared: null });
  }
}
