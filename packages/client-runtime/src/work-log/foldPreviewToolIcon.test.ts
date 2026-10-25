import { describe, expect, it } from "@effect/vitest";

import { extractToolActivityPresentation } from "./toolPresentation.ts";

describe("typed preview tool results", () => {
  it("retains a website icon from the successful MCP envelope", () => {
    expect(
      extractToolActivityPresentation({
        type: "dynamic_tool",
        toolName: "mcp__t3-code__preview_open",
        status: "completed",
        output: { structuredContent: { url: "https://example.com/demo" } },
      }).toolIcon,
    ).toEqual({ _tag: "website", pageUrl: "https://example.com/demo" });
  });
  it("extracts the page from a JSON text MCP result", () => {
    expect(
      extractToolActivityPresentation({
        type: "dynamic_tool",
        toolName: "mcp__t3-code__preview_open",
        status: "completed",
        output: JSON.stringify({
          content: [{ type: "text", text: JSON.stringify({ url: "https://example.com/demo" }) }],
        }),
      }).toolIcon,
    ).toEqual({ _tag: "website", pageUrl: "https://example.com/demo" });
  });
  it("does not turn failed results or unsafe URLs into website icons", () => {
    for (const payload of [
      { status: "failed", output: { url: "https://example.com" } },
      {
        status: "completed",
        output: { isError: true, structuredContent: { url: "https://example.com" } },
      },
      { status: "completed", output: { url: "file:///private" } },
    ])
      expect(
        extractToolActivityPresentation({
          type: "dynamic_tool",
          toolName: "mcp__t3-code__preview_open",
          ...payload,
        }).toolIcon,
      ).toBeUndefined();
  });
});
