import { PitbossSourceConfig, type PitbossSource } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

export interface SourceObservation {
  readonly source: PitbossSource;
  readonly title: string;
  readonly outcome: string;
}
const Text = Schema.NullOr(Schema.String);
const VikunjaTasks = Schema.Array(
  Schema.Struct({
    id: Schema.Int,
    project_id: Schema.Int,
    title: Schema.String,
    description: Schema.optional(Schema.String),
    done: Schema.Boolean,
    priority: Schema.Int,
  }),
);
const JiraPage = Schema.Struct({
  issues: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      key: Schema.String,
      fields: Schema.Struct({
        summary: Schema.String,
        description: Schema.optional(Schema.Unknown),
        status: Schema.Struct({ name: Schema.String }),
        priority: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
      }),
    }),
  ),
  nextPageToken: Schema.optional(Schema.String),
  isLast: Schema.optional(Schema.Boolean),
});
const LinearPage = Schema.Struct({
  data: Schema.Struct({
    issues: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          identifier: Schema.String,
          title: Schema.String,
          description: Text,
          url: Schema.String,
          priority: Schema.Int,
          state: Schema.Struct({ name: Schema.String }),
          team: Schema.Struct({ id: Schema.String }),
        }),
      ),
      pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean, endCursor: Text }),
    }),
  }),
});
const decodeVikunja = Schema.decodeUnknownSync(VikunjaTasks);
const decodeJira = Schema.decodeUnknownSync(JiraPage);
const decodeLinear = Schema.decodeUnknownSync(LinearPage);
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Reads source workflow only. The caller separately decides whether to activate work. */
export async function readSourcePage(
  config: PitbossSourceConfig,
  token: string,
  cursor: string | null,
  fetcher: (input: string | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ observations: ReadonlyArray<SourceObservation>; nextCursor: string | null }> {
  const base = new URL(config.baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
    throw new Error("Use an HTTP(S) tracker URL without embedded credentials.");
  const observedAt = DateTime.formatIso(DateTime.nowUnsafe());
  const credential = token.trim();
  // Linear personal API keys use the raw key; only OAuth tokens use Bearer.
  const linearKey = credential.replace(/^Bearer\s+/i, "");
  const headers = {
    Authorization:
      config.kind === "linear" && linearKey.startsWith("lin_api_")
        ? linearKey
        : /^(Bearer|Basic) /i.test(credential)
          ? credential
          : `Bearer ${credential}`,
    "Content-Type": "application/json",
  };
  let url: URL;
  let body: string | undefined;
  if (config.kind === "vikunja") {
    url = new URL("api/v1/tasks", `${base.href.replace(/\/$/, "")}/`);
    url.searchParams.set("filter", `project_id = ${config.remoteProjectId}`);
    url.searchParams.set("page", cursor ?? "1");
    url.searchParams.set("per_page", "50");
  } else if (config.kind === "jira") {
    url = new URL("rest/api/3/search/jql", `${base.href.replace(/\/$/, "")}/`);
    body = encode({
      jql: `project = ${encode(config.remoteProjectId)} ORDER BY updated ASC`,
      fields: ["summary", "description", "status", "priority"],
      maxResults: 50,
      ...(cursor ? { nextPageToken: cursor } : {}),
    });
  } else {
    url = new URL("graphql", `${base.href.replace(/\/$/, "")}/`);
    body = encode({
      query:
        "query PitbossTasks($team: ID!, $after: String) { issues(first: 50, after: $after, filter: {team: {id: {eq: $team}}}) { nodes { id identifier title description url priority state { name } team { id } } pageInfo { hasNextPage endCursor } } }",
      variables: { team: config.remoteProjectId, after: cursor },
    });
  }
  const response = await fetcher(url, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      `Tracker returned HTTP ${response.status}. Check its read credentials and selected scope.`,
    );
  const raw: unknown = await response.json();
  const source = (
    itemId: string,
    key: string,
    itemUrl: string,
    status: string,
    priority: string,
  ): PitbossSource => ({
    kind: config.kind,
    tenantId: config.tenantId,
    itemId,
    key,
    url: itemUrl,
    status,
    priority,
    observedAt,
  });
  if (config.kind === "vikunja") {
    const tasks = decodeVikunja(raw);
    return {
      observations: tasks
        .filter((task) => String(task.project_id) === config.remoteProjectId)
        .map((task) => ({
          source: source(
            String(task.id),
            `#${task.id}`,
            new URL(`tasks/${task.id}`, base).href,
            task.done ? "Done" : "Open",
            String(task.priority),
          ),
          title: task.title,
          outcome: task.description ?? task.title,
        })),
      nextCursor: tasks.length === 50 ? String(Number(cursor ?? "1") + 1) : null,
    };
  }
  if (config.kind === "jira") {
    const page = decodeJira(raw);
    return {
      observations: page.issues.map((issue) => ({
        source: source(
          issue.id,
          issue.key,
          new URL(`browse/${issue.key}`, base).href,
          issue.fields.status.name,
          issue.fields.priority?.name ?? "Unspecified",
        ),
        title: issue.fields.summary,
        outcome:
          typeof issue.fields.description === "string"
            ? issue.fields.description
            : encode(issue.fields.description ?? ""),
      })),
      nextCursor: page.isLast ? null : (page.nextPageToken ?? null),
    };
  }
  const page = decodeLinear(raw).data.issues;
  return {
    observations: page.nodes
      .filter((issue) => issue.team.id === config.remoteProjectId)
      .map((issue) => ({
        source: source(
          issue.id,
          issue.identifier,
          issue.url,
          issue.state.name,
          String(issue.priority),
        ),
        title: issue.title,
        outcome: issue.description ?? issue.title,
      })),
    nextCursor: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
  };
}
