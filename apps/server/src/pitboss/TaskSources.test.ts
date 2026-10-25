import { expect, it } from "@effect/vitest";
import { ProjectId, type PitbossSourceConfig } from "@t3tools/contracts";
import { readSourcePage } from "./TaskSources.ts";

const config: PitbossSourceConfig = {
  id: "test",
  kind: "vikunja",
  baseUrl: "http://tracker.test",
  tenantId: "local",
  remoteProjectId: "2",
  projectId: ProjectId.make("tools"),
  enabled: true,
};

it("limits Vikunja observations to the selected project and preserves source completion", async () => {
  const fetcher: NonNullable<Parameters<typeof readSourcePage>[3]> = async (url, init) => {
    expect(String(url)).toContain("project_id+%3D+2");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
    return Response.json([
      { id: 1, project_id: 2, title: "Selected", description: "Outcome", done: true, priority: 3 },
      { id: 2, project_id: 3, title: "Outside scope", done: false, priority: 0 },
    ]);
  };
  const result = await readSourcePage(config, "test-token", null, fetcher);
  expect(result.observations.map((item) => [item.title, item.source.status])).toEqual([
    ["Selected", "Done"],
  ]);
  expect(result.nextCursor).toBeNull();
});

it("uses Jira's pagination token without interpreting its workflow as T3 acceptance", async () => {
  const fetcher: NonNullable<Parameters<typeof readSourcePage>[3]> = async (_url, init) => {
    expect(JSON.parse(String(init?.body)).nextPageToken).toBe("page-two");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Basic test");
    return Response.json({
      issues: [
        {
          id: "100",
          key: "DEV-1",
          fields: { summary: "Fix", description: "Outcome", status: { name: "Closed" } },
        },
      ],
      nextPageToken: "page-three",
    });
  };
  const result = await readSourcePage(
    { ...config, kind: "jira", remoteProjectId: "DEV" },
    "Basic test",
    "page-two",
    fetcher,
  );
  expect(result.nextCursor).toBe("page-three");
  expect(result.observations[0]?.source.status).toBe("Closed");
});

it("filters Linear results by team and follows its cursor", async () => {
  const fetcher: NonNullable<Parameters<typeof readSourcePage>[3]> = async () =>
    Response.json({
      data: {
        issues: {
          nodes: [
            {
              id: "issue",
              identifier: "DEV-1",
              title: "Fix",
              description: null,
              url: "https://linear.app/test/issue",
              priority: 2,
              state: { name: "In progress" },
              team: { id: "team" },
            },
          ],
          pageInfo: { hasNextPage: true, endCursor: "next" },
        },
      },
    });
  const result = await readSourcePage(
    { ...config, kind: "linear", remoteProjectId: "team" },
    "test",
    null,
    fetcher,
  );
  expect(result.nextCursor).toBe("next");
  expect(result.observations[0]?.source.itemId).toBe("issue");
});

it("fails explicitly on expired credentials without echoing them", async () => {
  const fetcher: NonNullable<Parameters<typeof readSourcePage>[3]> = async () =>
    new Response(null, { status: 401 });
  await expect(readSourcePage(config, "secret-not-for-errors", null, fetcher)).rejects.toThrow(
    "HTTP 401",
  );
});

it.each([
  ["lin_api_test", "lin_api_test"],
  ["  lin_api_test\n", "lin_api_test"],
  ["Bearer lin_api_test", "lin_api_test"],
  ["oauth-test-token", "Bearer oauth-test-token"],
  ["Bearer oauth-test-token", "Bearer oauth-test-token"],
])("authenticates Linear with %j", async (token, authorization) => {
  const fetcher: NonNullable<Parameters<typeof readSourcePage>[3]> = async (_url, init) => {
    if (new Headers(init?.headers).get("Authorization") !== authorization)
      return new Response(null, { status: 400 });
    return Response.json({
      data: {
        issues: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
  };
  await expect(
    readSourcePage({ ...config, kind: "linear" }, token, null, fetcher),
  ).resolves.toEqual({ observations: [], nextCursor: null });
});
