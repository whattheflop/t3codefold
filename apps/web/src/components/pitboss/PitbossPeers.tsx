import { useEffect, useState } from "react";
import { ChevronRightIcon, NetworkIcon } from "lucide-react";
import {
  EnvironmentId,
  type PitbossAction,
  type PitbossPeerCommand,
  type PitbossTask,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
const inputClass = "rounded border border-border bg-background p-2";

export function PitbossPeers({
  environmentId,
  tasks,
  onCommand,
}: {
  environmentId: EnvironmentId;
  tasks: readonly PitbossTask[];
  onCommand: (action: PitbossAction) => Promise<boolean>;
}) {
  const query = useEnvironmentQuery(serverEnvironment.pitbossPeers({ environmentId, input: {} }));
  const mutate = useAtomCommand(serverEnvironment.pitbossPeerCommand, {
    label: "GLaDOS shared coordination",
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState("");
  const [remote, setRemote] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [scope, setScope] = useState("");
  const scopes = [
    ...new Map(
      tasks.flatMap((task) =>
        task.source?.scope
          ? [[task.source.scope, `${task.source.kind} · ${task.source.tenantId}`] as const]
          : [],
      ),
    ).entries(),
  ];
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refresh remote state while this section is open.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(query.refresh, 15000);
    return () => clearInterval(timer);
  }, [open, query.refresh]);
  const execute = async (input: PitbossPeerCommand) => {
    setBusy(true);
    setError(null);
    const result = await mutate({ environmentId, input });
    setBusy(false);
    query.refresh();
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else setSecret("");
  };
  const self = query.data?.environmentId;
  const connected =
    query.data?.peers.filter((peer) => peer.config.enabled && !peer.error && peer.lastSeenAt)
      .length ?? 0;
  return (
    <details
      className="group px-3 py-3 sm:px-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <NetworkIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Peers</span>
          <span className="block text-sm text-muted-foreground/80">
            Share work with GLaDOS on other environments
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {query.data?.peers.length ? `${connected} connected` : "None"}
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground group-open:rotate-90" />
      </summary>
      <p className="my-2 text-xs text-muted-foreground">
        Each environment keeps its own GLaDOS. Sharing a tracker scope requires approval on both
        environments. Offline peers keep their existing authority; there is no automatic takeover.
      </p>
      <p className="my-2 break-all text-xs">
        This environment: <code>{self}</code>
      </p>
      {(error || query.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? query.error}
        </p>
      )}
      {query.data?.peers.map((peer) => (
        <div key={peer.config.id} className="my-3 rounded-lg border border-border p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="flex-1">{peer.config.id}</strong>
            <span>
              {peer.error ??
                (peer.lastSeenAt ? `Last contact ${peer.lastSeenAt}` : "Awaiting peer")}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !peer.config.enabled}
              onClick={() => void execute({ type: "sync", peerId: peer.config.id })}
            >
              Reconcile now
            </Button>
          </div>
          <p className="mt-2 text-muted-foreground">
            Task home: {peer.homeEnvironmentId ?? "Chosen with the first agreement"}. Coordinator
            changes retain that home.
          </p>
          <p className="mt-2 text-muted-foreground">
            {peer.pendingMessages ?? 0} messages awaiting durable receipt
          </p>
          <form
            className="mt-2 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void onCommand({
                type: "send-peer",
                peerId: peer.config.id,
                text: drafts[peer.config.id] ?? "",
              }).then((sent) => {
                if (sent) {
                  setDrafts((values) => ({ ...values, [peer.config.id]: "" }));
                  query.refresh();
                }
              });
            }}
          >
            <label className="grid gap-1">
              Message to {peer.config.id}
              <textarea
                required
                maxLength={12000}
                className={inputClass}
                value={drafts[peer.config.id] ?? ""}
                onChange={(event) =>
                  setDrafts((values) => ({ ...values, [peer.config.id]: event.target.value }))
                }
              />
            </label>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={busy || !peer.config.enabled}
            >
              Queue message
            </Button>
          </form>
          {peer.view.proposals.map((proposal) => {
            const approved = proposal.participants.every(
              (participant) => peer.view.approvals[participant] === proposal.id,
            );
            return (
              <div key={proposal.id} className="mt-2 rounded bg-muted/40 p-2">
                <p>
                  {proposal.coordinator === self ? "This environment" : peer.config.id} coordinates
                  this source · {approved ? "Approved by both" : "Awaiting approvals"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Task home: {proposal.homeEnvironmentId ?? proposal.coordinator}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Local:{" "}
                  {self && peer.view.approvals[self] === proposal.id
                    ? "approved"
                    : self && peer.view.rejections?.[self]?.includes(proposal.id)
                      ? "declined"
                      : "pending"}{" "}
                  · Peer:{" "}
                  {peer.view.approvals[peer.config.environmentId] === proposal.id
                    ? "approved"
                    : peer.view.rejections?.[peer.config.environmentId]?.includes(proposal.id)
                      ? "declined"
                      : "pending"}
                </p>
                {self && !peer.view.rejections?.[self]?.includes(proposal.id) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2"
                    disabled={busy || !peer.config.enabled}
                    onClick={() =>
                      void execute({
                        type: "decline",
                        peerId: peer.config.id,
                        proposalId: proposal.id,
                      })
                    }
                  >
                    {peer.view.approvals[self] === proposal.id ? "Withdraw approval" : "Decline"}
                  </Button>
                )}
                {self && peer.view.approvals[self] !== proposal.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={busy}
                    onClick={() =>
                      void execute({
                        type: "approve",
                        peerId: peer.config.id,
                        proposalId: proposal.id,
                      })
                    }
                  >
                    Approve coordination change
                  </Button>
                )}
              </div>
            );
          })}
          <div className="mt-2 flex flex-wrap gap-2">
            {self &&
              [self, peer.config.environmentId].map((coordinator) => (
                <Button
                  key={coordinator}
                  size="sm"
                  variant="outline"
                  disabled={busy || !peer.config.enabled}
                  onClick={() =>
                    void execute({
                      type: "propose",
                      peerId: peer.config.id,
                      proposal: {
                        id: randomUUID(),
                        scope: peer.config.scope,
                        coordinator,
                        homeEnvironmentId: peer.homeEnvironmentId ?? coordinator,
                        participants: [self, peer.config.environmentId],
                      },
                    })
                  }
                >
                  Propose {coordinator === self ? "this environment" : peer.config.id}
                </Button>
              ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void execute({
                  type: "configure",
                  config: { ...peer.config, enabled: !peer.config.enabled },
                })
              }
            >
              {peer.config.enabled ? "Disconnect peer" : "Reconnect peer"}
            </Button>
          </div>
        </div>
      ))}
      <details className="mt-3" open={!query.data?.peers.length}>
        <summary className="cursor-pointer text-xs font-medium">Connect an environment</summary>
        <form
          className="mt-3 grid gap-2 text-xs md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void execute({
              type: "configure",
              config: { id, environmentId: EnvironmentId.make(remote), url, scope, enabled: true },
              secret,
            });
          }}
        >
          <label className="grid gap-1">
            Peer name
            <input
              required
              value={id}
              onChange={(event) => setId(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            Peer environment ID
            <input
              required
              value={remote}
              onChange={(event) => setRemote(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            Peer server URL
            <input
              required
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            Shared tracker scope
            <select
              required
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              className={inputClass}
            >
              <option value="">Choose imported source</option>
              {scopes.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            Shared peer key
            <input
              required
              type="password"
              minLength={32}
              autoComplete="new-password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              className={inputClass}
            />
          </label>
          <p className="self-center text-muted-foreground">
            Configure both environments with the same dedicated random key (at least 32 characters).
          </p>
          <Button size="sm" type="submit" disabled={busy || scopes.length === 0}>
            Connect peer
          </Button>
        </form>
      </details>
    </details>
  );
}
