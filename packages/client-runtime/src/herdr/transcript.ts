import { type CoreItem, mergeCoreItems } from "./protocol.ts";

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value ?? ""));
export type TranscriptProvider = "claude" | "codex";
export function appendTranscript(
  previous: readonly CoreItem[],
  source: string,
  provider: TranscriptProvider,
  records: readonly { line: number; value: unknown }[],
) {
  let items = [...previous];
  for (const { line, value } of records) {
    const row = object(value);
    if (!row) continue;
    const id = `${source}:${line}`;
    const at = typeof row.timestamp === "string" ? row.timestamp : undefined;
    if (provider === "claude") {
      const message = object(row.message);
      if (!message || !["user", "assistant"].includes(String(message.role))) continue;
      const content =
        typeof message.content === "string"
          ? [{ type: "text", text: message.content }]
          : Array.isArray(message.content)
            ? message.content
            : [];
      for (const [index, raw] of content.entries()) {
        const block = object(raw);
        if (!block) continue;
        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          items = updateTool(
            items,
            block.tool_use_id,
            text(block.content),
            line,
            block.is_error === true ? "error" : "done",
            source,
          );
          continue;
        }
        const partId = `${id}:${index}`;
        if (block.type === "text" && typeof block.text === "string") {
          items = mergeCoreItems(items, [
            {
              id: partId,
              sequence: line * 1000 + index,
              revision: line,
              ...(at ? { at } : {}),
              role: message.role === "assistant" ? "assistant" : "user",
              source: message.role === "assistant" ? provider : promptSource(block.text),
              parts: [{ id: partId, kind: "text", text: block.text }],
            },
          ]);
        } else if (block.type === "tool_use" && typeof block.id === "string") {
          items = mergeCoreItems(items, [
            {
              id: partId,
              sequence: line * 1000 + index,
              revision: line,
              ...(at ? { at } : {}),
              role: "assistant",
              source: provider,
              parts: [
                {
                  id: partId,
                  kind: "tool",
                  name: typeof block.name === "string" ? block.name : "Tool",
                  text: text(block.input),
                  callId: block.id,
                  state: "recorded",
                },
              ],
            },
          ]);
        }
      }
    } else if (row.type === "response_item") {
      const payload = object(row.payload);
      if (!payload) continue;
      if (
        payload.type === "message" &&
        ["user", "assistant"].includes(String(payload.role)) &&
        Array.isArray(payload.content)
      ) {
        const parts = payload.content.flatMap((raw, index) => {
          const block = object(raw);
          return block && typeof block.text === "string"
            ? [{ id: `${id}:${index}`, kind: "text" as const, text: block.text }]
            : [];
        });
        if (parts.length)
          items = mergeCoreItems(items, [
            {
              id,
              sequence: line * 1000,
              revision: line,
              ...(at ? { at } : {}),
              role: payload.role === "assistant" ? "assistant" : "user",
              source:
                payload.role === "assistant"
                  ? provider
                  : promptSource(parts.map((part) => part.text).join("\n")),
              parts,
            },
          ]);
      } else if (
        ["function_call", "custom_tool_call"].includes(String(payload.type)) &&
        typeof payload.call_id === "string"
      ) {
        items = mergeCoreItems(items, [
          {
            id,
            sequence: line * 1000,
            revision: line,
            ...(at ? { at } : {}),
            role: "assistant",
            source: provider,
            parts: [
              {
                id,
                kind: "tool",
                name: typeof payload.name === "string" ? payload.name : "Tool",
                callId: payload.call_id,
                text: text(payload.arguments ?? payload.input),
                state: "recorded",
              },
            ],
          },
        ]);
      } else if (
        ["function_call_output", "custom_tool_call_output"].includes(String(payload.type)) &&
        typeof payload.call_id === "string"
      ) {
        items = updateTool(items, payload.call_id, text(payload.output), line, "done", source);
      }
    }
  }
  return items;
}
function updateTool(
  items: readonly CoreItem[],
  callId: string,
  output: string,
  revision: number,
  state: string,
  source: string,
) {
  if (!items.some((item) => item.parts.some((part) => part.callId === callId))) {
    return mergeCoreItems(items, [
      {
        id: `${source}:result:${revision}`,
        sequence: revision * 1000,
        revision,
        role: "assistant",
        source: "provider tool result (call outside loaded history)",
        parts: [
          {
            id: `${source}:result:${revision}`,
            kind: "tool",
            callId,
            name: "Earlier tool call",
            text: "",
            output,
            state,
          },
        ],
      },
    ]);
  }
  return items.map((item) =>
    item.parts.some((part) => part.callId === callId) && revision > item.revision
      ? {
          ...item,
          revision,
          parts: item.parts.map((part) =>
            part.callId === callId ? { ...part, output, state } : part,
          ),
        }
      : item,
  );
}

function promptSource(value: string) {
  if (value.startsWith("[factory]")) return "factory wake";
  if (value.startsWith("[herd]")) return "herd brief";
  // Claude prefixes relayed messages with a sentence, so look near the start, not at it.
  if (/<(cross-session-message|teammate-message|agent-message)\b/.test(value.slice(0, 400)))
    return "peer agent";
  return "provider user record (origin unverified)";
}
