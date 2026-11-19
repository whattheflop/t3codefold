import { MessageId } from "@t3tools/contracts";
import type { CoreItem, CorePart } from "@t3tools/client-runtime/herdr/protocol";

import type { TimelineEntry, WorkLogToolLifecycleStatus } from "../../session-logic";

// Herdr's own prompt sources (see transcript.ts promptSource). Anything else on a user record
// was typed into the provider, which in a factory is the person driving it.
const AUTOMATED_SOURCES = new Set(["factory wake", "herd brief", "peer agent"]);

const toolStatus = (state: string | undefined): WorkLogToolLifecycleStatus =>
  state === "done" ? "completed" : state === "error" ? "failed" : "inProgress";

/**
 * Herdr transcript items as T3 timeline entries: text parts become one message, and every tool,
 * notice or interaction part becomes its own work-log row, in part order.
 */
export function coreItemsToTimelineEntries(items: readonly CoreItem[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  // Rows without a provider time inherit the previous one so the list never jumps backwards.
  let lastAt = new Date(0).toISOString();
  for (const item of items) {
    const createdAt = item.at ?? lastAt;
    lastAt = createdAt;
    const text = item.parts
      .filter((part) => part.kind === "text")
      .map((part) => part.text)
      .join("\n\n");
    if (text.trim()) {
      const role = item.role === "user" ? "user" : item.role === "system" ? "system" : "assistant";
      const automated = role === "user" && AUTOMATED_SOURCES.has(item.source);
      entries.push({
        id: item.id,
        kind: "message",
        createdAt,
        message: {
          id: MessageId.make(item.id),
          role,
          text,
          runId: null,
          streaming: false,
          createdAt,
          updatedAt: createdAt,
          ...(automated ? { createdBy: "agent" as const, creationSource: "mcp" as const } : {}),
        },
      });
    }
    for (const part of item.parts) {
      if (part.kind === "text") continue;
      entries.push({
        id: `${item.id}:${part.id}`,
        kind: "work",
        createdAt,
        entry: workEntry(part, `${item.id}:${part.id}`, createdAt),
      });
    }
  }
  return entries;
}

function workEntry(part: CorePart, id: string, createdAt: string) {
  if (part.kind !== "tool") {
    return { id, createdAt, label: part.text, tone: "info" as const };
  }
  const name = part.name ?? "Tool";
  return {
    id,
    createdAt,
    label: name,
    toolTitle: name,
    tone: "tool" as const,
    toolLifecycleStatus: toolStatus(part.state),
    ...(part.callId ? { toolCallId: part.callId } : {}),
    ...(part.text ? { command: part.text } : {}),
    ...(part.output !== undefined ? { detail: part.output } : {}),
  };
}
