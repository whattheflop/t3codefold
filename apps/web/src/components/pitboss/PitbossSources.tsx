import { useEffect, useState } from "react";
import { ChevronRightIcon, InboxIcon } from "lucide-react";
import type {
  EnvironmentId,
  PitbossSourceConfig,
  PitbossSourceRequest,
  ProjectId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { LINEAR_API_URL, sourceConnectionName } from "./gladosSettings.logic";

const inputClass = "rounded border border-border bg-background p-2";

export function PitbossSources({
  environmentId,
  projectIds,
  projectName,
}: {
  environmentId: EnvironmentId;
  /** Projects a source may import into; GLaDOS only works in its brief's projects. */
  projectIds: ReadonlyArray<ProjectId>;
  projectName: (id: ProjectId) => string;
}) {
  const sources = useEnvironmentQuery(
    serverEnvironment.pitbossSources({ environmentId, input: {} }),
  );
  const mutate = useAtomCommand(serverEnvironment.pitbossSourceCommand, {
    label: "GLaDOS task sources",
  });
  const refreshSources = sources.refresh;
  const [open, setOpen] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refresh remote state while this section is open.
  useEffect(() => {
    if (!open) return;
    refreshSources();
    const timer = setInterval(refreshSources, 15000);
    return () => clearInterval(timer);
  }, [open, refreshSources]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<PitbossSourceConfig["kind"]>("linear");
  const [id, setId] = useState("");
  const [baseUrl, setBaseUrl] = useState(LINEAR_API_URL);
  const [scope, setScope] = useState("");
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState<ProjectId | "">("");
  const targetProjectId = projectIds.find((candidate) => candidate === projectId) ?? projectIds[0];
  const connected = sources.data?.sources ?? [];
  const execute = async (input: PitbossSourceRequest) => {
    setBusy(true);
    setError(null);
    const result = await mutate({ environmentId, input });
    setBusy(false);
    sources.refresh();
    if (result._tag === "Failure") {
      setError(String(squashAtomCommandFailure(result)));
      return;
    }
    setToken("");
  };
  return (
    <details
      className="group px-3 py-3 sm:px-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <InboxIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Task sources</span>
          <span className="block text-sm text-muted-foreground/80">
            Pull issues from Linear, Jira or Vikunja
          </span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {connected.length ? connected.map((source) => source.config.id).join(", ") : "None"}
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground group-open:rotate-90" />
      </summary>
      <p className="my-2 text-xs text-muted-foreground">
        Imports become candidates for review. Tracker status and accepted T3 work stay separate.
        Connections refresh every minute while enabled.
      </p>
      {(error || sources.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? sources.error}
        </p>
      )}
      {connected.map((source) => (
        <div
          key={source.config.id}
          className="my-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-xs"
        >
          <span className="flex-1">
            {source.config.id} · {source.config.kind} · {projectName(source.config.projectId)} ·{" "}
            {source.error ?? (source.lastSyncAt ? `Last sync ${source.lastSyncAt}` : "Not synced")}
          </span>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy || !source.config.enabled}
            onClick={() => void execute({ type: "sync", id: source.config.id })}
          >
            Sync now
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void execute({
                type: "configure",
                config: { ...source.config, enabled: !source.config.enabled },
              })
            }
          >
            {source.config.enabled ? "Disable" : "Enable"}
          </Button>
        </div>
      ))}
      <details className="mt-3" open={!connected.length}>
        <summary className="cursor-pointer text-xs font-medium">Add or update a source</summary>
        {!targetProjectId ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Add a project to the brief first. Imported work lands in one of its projects.
          </p>
        ) : (
          <form
            className="mt-3 grid gap-2 text-xs md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void execute({
                type: "configure",
                config: {
                  id:
                    id.trim() ||
                    sourceConnectionName(
                      kind,
                      connected.map((source) => source.config.id),
                    ),
                  kind,
                  baseUrl,
                  tenantId: new URL(baseUrl).origin,
                  remoteProjectId: scope,
                  projectId: targetProjectId,
                  enabled: true,
                },
                token,
              });
            }}
          >
            <label className="grid gap-1">
              Tracker
              <select
                value={kind}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value !== "jira" && value !== "linear" && value !== "vikunja") return;
                  setKind(value);
                  if (value === "linear" && !baseUrl) setBaseUrl(LINEAR_API_URL);
                  if (value !== "linear" && baseUrl === LINEAR_API_URL) setBaseUrl("");
                }}
                className={inputClass}
              >
                <option value="linear">Linear</option>
                <option value="jira">Jira</option>
                <option value="vikunja">Vikunja</option>
              </select>
            </label>
            <label className="grid gap-1">
              Server URL
              <input
                required
                type="url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={kind === "linear" ? LINEAR_API_URL : "http://localhost:18456"}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1">
              {kind === "linear" ? "Team ID" : "Project ID or key"}
              <input
                required
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="grid gap-1">
              Read credential
              <input
                required
                type="password"
                autoComplete="new-password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className={inputClass}
              />
            </label>
            {projectIds.length > 1 && (
              <label className="grid gap-1">
                Import into
                <select
                  value={targetProjectId}
                  onChange={(event) =>
                    setProjectId(
                      projectIds.find((candidate) => candidate === event.target.value) ?? "",
                    )
                  }
                  className={inputClass}
                >
                  {projectIds.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {projectName(candidate)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="grid gap-1">
              Connection name (optional)
              <input
                pattern={"[a-zA-Z0-9_\\-]{1,80}"}
                value={id}
                onChange={(event) => setId(event.target.value)}
                placeholder={sourceConnectionName(
                  kind,
                  connected.map((source) => source.config.id),
                )}
                className={inputClass}
              />
            </label>
            <div className="flex items-end md:col-span-2">
              <Button size="sm" type="submit" disabled={busy}>
                Connect source
              </Button>
            </div>
          </form>
        )}
      </details>
    </details>
  );
}
