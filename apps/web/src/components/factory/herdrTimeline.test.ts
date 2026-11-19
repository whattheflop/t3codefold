import type { CoreAgent, CoreItem } from "@t3tools/client-runtime/herdr/protocol";
import { describe, expect, it } from "vite-plus/test";

import { orderFleet } from "./HerdrFleetList";
import { coreItemsToTimelineEntries } from "./herdrTimeline";

const item = (overrides: Partial<CoreItem> & Pick<CoreItem, "id" | "parts">): CoreItem => ({
  sequence: 1,
  revision: 1,
  role: "assistant",
  source: "claude",
  ...overrides,
});

describe("coreItemsToTimelineEntries", () => {
  it("maps Herdr records onto T3 messages and work rows", () => {
    const entries = coreItemsToTimelineEntries([
      item({
        id: "wake",
        role: "user",
        source: "factory wake",
        at: "2026-11-11T01:00:00.000Z",
        parts: [{ id: "p", kind: "text", text: "[factory] check CI" }],
      }),
      item({
        id: "mine",
        role: "user",
        source: "provider user record (origin unverified)",
        parts: [{ id: "p", kind: "text", text: "hi" }],
      }),
      item({
        id: "reply",
        parts: [
          { id: "t", kind: "text", text: "Checking" },
          {
            id: "c",
            kind: "tool",
            name: "Bash",
            text: "ls",
            callId: "c1",
            state: "done",
            output: "a.ts",
          },
        ],
      }),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(["message", "message", "message", "work"]);
    const [wake, mine, , tool] = entries;
    // Automated prompts fold like agent messages; a person's own prompt stays a plain bubble.
    expect(wake?.kind === "message" && wake.message.createdBy).toBe("agent");
    expect(mine?.kind === "message" && mine.message.createdBy).toBeUndefined();
    // Records without a provider time keep the previous one instead of jumping to the epoch.
    expect(mine?.createdAt).toBe("2026-11-11T01:00:00.000Z");
    expect(tool?.kind === "work" && tool.entry).toMatchObject({
      tone: "tool",
      label: "Bash",
      toolCallId: "c1",
      command: "ls",
      detail: "a.ts",
      toolLifecycleStatus: "completed",
    });
  });
});

describe("orderFleet", () => {
  const agent = (id: string, parentId: string | null): CoreAgent => ({
    id,
    label: id,
    terminal: id,
    parentId,
    role: null,
    tab: null,
    cwd: null,
    provider: null,
    model: null,
    conversationId: null,
    generation: "unknown",
    status: "idle",
    processState: "live",
    capabilities: [],
  });
  it("nests children under their parent and keeps orphans and cycles at the root", () => {
    const nodes = orderFleet(
      [
        agent("worker", "sub"),
        agent("sub", "commander"),
        agent("commander", null),
        agent("orphan", "gone"),
        agent("x", "y"),
        agent("y", "x"),
      ],
      [],
    );
    expect(nodes.map((node) => [node.agent.id, node.depth])).toEqual([
      ["commander", 0],
      ["sub", 1],
      ["worker", 2],
      ["orphan", 0],
      ["x", 0],
      ["y", 1],
    ]);
  });
});
