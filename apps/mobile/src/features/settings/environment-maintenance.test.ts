import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { canMaintainEnvironment, findEnvironmentUpdate } from "./environment-maintenance";

afterEach(() => vi.unstubAllGlobals());

describe("environment maintenance access", () => {
  it("requires a connected authenticated session with operate permission", () => {
    const session = {
      authenticated: true,
      auth: {
        policy: "remote-reachable" as const,
        bootstrapMethods: [],
        sessionMethods: [],
        sessionCookieName: "session",
      },
      scopes: [AuthOrchestrationOperateScope],
    };
    expect(canMaintainEnvironment(session, true)).toBe(true);
    expect(canMaintainEnvironment(session, false)).toBe(false);
    expect(canMaintainEnvironment({ ...session, authenticated: false }, true)).toBe(false);
    expect(canMaintainEnvironment({ ...session, scopes: [] }, true)).toBe(false);
    const { scopes: _, ...legacy } = session;
    expect(canMaintainEnvironment(legacy, true)).toBe(false);
    expect(canMaintainEnvironment(null, true)).toBe(false);
  });

  it.each([
    { permissions: ["environment:maintain"], expected: true },
    { permissions: ["providers:manage"], expected: false },
    { permissions: [], expected: false },
  ] as const)(
    "honors exact permissions over legacy scopes: $permissions",
    ({ permissions, expected }) => {
      expect(
        canMaintainEnvironment(
          {
            authenticated: true,
            auth: {
              policy: "remote-reachable",
              bootstrapMethods: [],
              sessionMethods: [],
              sessionCookieName: "session",
              serverUpdateScope: "environment:maintain",
            },
            scopes: ["orchestration:operate"],
            permissions,
          },
          true,
        ),
      ).toBe(expected);
    },
  );
});

describe("environment release checks", () => {
  const signal = new AbortController().signal;
  const feed = (...tags: ReadonlyArray<string>) =>
    new Response(
      `<feed><id>tag:github.com,2008:https://github.com/BreakTheBeta/T3codefold/releases</id>${tags
        .map((tag) => `<entry><id>tag:github.com,2008:Repository/1/${tag}</id></entry>`)
        .join("")}</feed>`,
    );

  it("checks stable server updates from the feed without mistaking mobile releases", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        url === "https://github.com/BreakTheBeta/T3codefold/releases.atom" &&
        new Headers(init?.headers).get("Accept") === "application/atom+xml"
          ? feed("fold-mobile-v9.0.0", "fold-server-v1.1.0")
          : new Response(null, { status: 403 }),
      ),
    );
    expect(await findEnvironmentUpdate("1.0.0", signal)).toBe("1.1.0");
    expect(await findEnvironmentUpdate("1.1.0", signal)).toBeNull();
    expect(await findEnvironmentUpdate("1.3.0", signal)).toBeNull();
  });

  it("keeps nightly and preview hosts on their channel without using the anonymous API quota", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "https://github.com/BreakTheBeta/T3codefold/releases.atom"
          ? feed(
              "desktop-preview",
              "fold-server-v1.0.0-preview.20260924.3",
              "fold-server-v1.0.0-nightly.20260924.2",
              "fold-server-v1.0.0",
              "fold-server-v1.0.0-nightly.20260923.1",
            )
          : new Response(null, { status: 403 }),
      ),
    );
    expect(await findEnvironmentUpdate("1.0.0-nightly.20260923.1", signal)).toBe(
      "1.0.0-nightly.20260924.2",
    );
    expect(await findEnvironmentUpdate("1.0.0-nightly.20260924.2", signal)).toBeNull();
    expect(await findEnvironmentUpdate("1.0.0-preview.20260923.1", signal)).toBe(
      "1.0.0-preview.20260924.3",
    );
    expect(await findEnvironmentUpdate("1.0.0-preview.20260925.1", signal)).toBeNull();
  });

  it("finds a published preview beyond the ten-entry feed and first API page", async () => {
    const nightlies = Array.from(
      { length: 10 },
      (_, i) => `fold-server-v1.0.0-nightly.20260930.${i}`,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://github.com/BreakTheBeta/T3codefold/releases.atom")
          return feed(...nightlies);
        if (
          url ===
          "https://api.github.com/repos/BreakTheBeta/T3codefold/releases?per_page=100&page=1"
        ) {
          return Response.json(
            Array.from({ length: 100 }, () => ({ tag_name: "fold-server-v2.0.0" })),
          );
        }
        if (
          url ===
          "https://api.github.com/repos/BreakTheBeta/T3codefold/releases?per_page=100&page=2"
        ) {
          return Response.json([
            { tag_name: "fold-server-v1.0.0-preview.20260925.1", draft: true },
            { tag_name: "fold-server-v1.0.0-preview.20260924.3" },
          ]);
        }
        throw new Error(`Unexpected release request: ${url}`);
      }),
    );
    expect(await findEnvironmentUpdate("1.0.0-preview.20260923.1", signal)).toBe(
      "1.0.0-preview.20260924.3",
    );
  });

  it("reports failed checks instead of claiming the server is current", async () => {
    for (const status of [403, 429]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
      await expect(findEnvironmentUpdate("1.0.0", signal)).rejects.toThrow(String(status));
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith(".atom")
          ? feed("fold-server-v1.0.0")
          : Response.json([{ tag_name: "fold-server-v1.0.0" }]),
      ),
    );
    await expect(findEnvironmentUpdate("1.0.0-nightly.20260923.1", signal)).rejects.toThrow(
      "No nightly release",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "invalid" })));
    await expect(findEnvironmentUpdate("1.0.0", signal)).rejects.toThrow();
  });

  it.each(["1.0.0", "1.0.0-nightly.20260923.1", "1.0.0-preview.20260923.1"])(
    "cancels the release request for %s, including the API fallback",
    async (currentVersion) => {
      const controller = new AbortController();
      const abort = new DOMException("Update check cancelled", "AbortError");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (currentVersion.includes("preview") && url.endsWith(".atom"))
            return feed("fold-server-v1.0.0");
          controller.abort(abort);
          init?.signal?.throwIfAborted();
          return new Response(null, { status: 500 });
        }),
      );
      await expect(findEnvironmentUpdate(currentVersion, controller.signal)).rejects.toBe(abort);
    },
  );
});
