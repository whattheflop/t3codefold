import { FOLD_REPOSITORY } from "@t3tools/shared/foldRelease";
import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { foldServerReleasePublishedAtom } from "./foldServerRelease";

const version = "0.0.46-nightly.20261012.3021";

// FetchHttpClient reads globalThis.fetch once and keeps it, so every test shares this mock.
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

async function settledCheck() {
  const atom = foldServerReleasePublishedAtom(version);
  const registry = AtomRegistry.make();
  const unmount = registry.mount(atom);
  try {
    await vi.waitFor(() => {
      const result = registry.get(atom);
      expect(AsyncResult.isInitial(result) || result.waiting).toBe(false);
    });
    return registry.get(atom);
  } finally {
    unmount();
    registry.dispose();
  }
}

describe("foldServerReleasePublishedAtom", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("checks Fold releases without tracing headers or a CORS preflight", async () => {
    fetchMock.mockImplementation(async () => Response.json({ version }));

    const result = await settledCheck();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = new Request(fetchMock.mock.calls[0]?.[0] ?? "", fetchMock.mock.calls[0]?.[1]);
    expect(request.url).toBe(
      `https://api.github.com/repos/${FOLD_REPOSITORY}/releases/tags/fold-server-v${version}`,
    );
    expect(request.headers.get("traceparent")).toBeNull();
    expect(request.headers.get("b3")).toBeNull();
    expect(AsyncResult.getOrElse(result, () => false)).toBe(true);
  });

  it("reports a missing Fold release as unpublished", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));

    const result = await settledCheck();

    expect(AsyncResult.isSuccess(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => true)).toBe(false);
  });

  it("leaves a failed first check unknown, which callers read as unpublished", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await settledCheck();

    expect(AsyncResult.isFailure(result)).toBe(true);
    expect(AsyncResult.getOrElse(result, () => false)).toBe(false);
  });
});
