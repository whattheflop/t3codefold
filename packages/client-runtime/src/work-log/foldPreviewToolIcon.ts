import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function trimmedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

const decodePreviewResult = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/**
 * V2 retains dynamic-tool output; recover the preview page without legacy activity
 * projection. The caller validates the returned icon like any other.
 */
export function foldPreviewToolIcon(
  payload: Record<string, unknown> | undefined,
): { readonly _tag: "website"; readonly pageUrl: string } | undefined {
  const name = payload?.toolName;
  if (typeof name !== "string" || !/^(?:mcp__)?(?:t3-code|t3_code|t3code)_{1,2}preview_/.test(name))
    return undefined;
  if (
    payload?.status === "failed" ||
    payload?.status === "declined" ||
    payload?.status === "cancelled"
  )
    return undefined;
  let output: unknown = payload?.output;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof output === "string") {
      if (output.length > 2 * 1024 * 1024) return undefined;
      const decoded = decodePreviewResult(output);
      if (Option.isNone(decoded)) return undefined;
      output = decoded.value;
    }
    const result = asRecord(output);
    if (!result || result.isError === true || result.is_error === true) return undefined;
    const pageUrl = trimmedString(
      asRecord(result.toolIcon)?.pageUrl ??
        (/preview_(?:open|navigate|status|snapshot)$/.test(name) ? result.url : undefined),
      4096,
    );
    if (pageUrl) return { _tag: "website", pageUrl };
    const content = Array.isArray(result.content) ? result.content : [];
    output =
      result.structuredContent ??
      content.map(asRecord).find((block) => block?.type === "text")?.text;
  }
  return undefined;
}
