import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  CrownIcon,
  FolderIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import {
  CommandId,
  PITBOSS_DEFAULT_MODEL_GUIDANCE,
  defaultPitbossBrief,
  pitbossAutonomy,
  withPitbossAutonomy,
  workNeedsYou,
  type EnvironmentId,
  type ModelSelection,
  type PitbossAction,
  type PitbossBrief,
  type ProjectId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEnvironmentProviders } from "../../state/environments";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { getAppModelOptionsForInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  isProviderInstancePickerReady,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useProjects, useServerConfigs } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../settings/settingsLayout";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PitbossPeers } from "./PitbossPeers";
import { PitbossSources } from "./PitbossSources";

/** The one place to set up and configure GLaDOS for the selected environment (/settings/glados). */
export function GladosSettingsPanel() {
  const { environment } = useSettingsScope();
  return (
    <SettingsPageContainer>
      {environment ? (
        <GladosSettings
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
        />
      ) : (
        <SettingsSection title="GLaDOS">
          <SettingsRow title="Connect an environment to set up GLaDOS." />
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}

/** Worker model choices on one environment, keeping saved models that are no longer offered. */
function useWorkerModelCatalog(environmentId: EnvironmentId, saved: ReadonlyArray<ModelSelection>) {
  const config = useServerConfigs().get(environmentId);
  const providers = useEnvironmentProviders().get(environmentId);
  const settings = useEnvironmentSettings(environmentId);
  const entries =
    config && providers
      ? sortProviderInstanceEntries(
          applyProviderInstanceSettings(
            deriveProviderInstanceEntries(providers),
            config.settings,
            null,
          ),
        )
      : [];
  const modelOptions = new Map(
    entries.map((entry) => {
      const options = getAppModelOptionsForInstance(settings, entry, null);
      for (const model of saved.filter((model) => model.instanceId === entry.instanceId)) {
        if (!options.some((option) => option.slug === model.model))
          options.push({
            slug: model.model,
            name: model.model,
            isCustom: false,
            isUnavailable: true,
          });
      }
      return [entry.instanceId, options];
    }),
  );
  const available = entries.flatMap((entry) =>
    isProviderInstancePickerReady(entry)
      ? (modelOptions.get(entry.instanceId) ?? [])
          .filter((model) => !model.isUnavailable)
          .map((model): ModelSelection => ({ instanceId: entry.instanceId, model: model.slug }))
      : [],
  );
  return {
    environmentId,
    entries,
    modelOptions,
    available,
    planModeEnabled: settings.planModeEnabled,
  };
}

function WorkerModelPicker({
  catalog,
  value,
  label,
  disabled,
  onChange,
}: {
  catalog: ReturnType<typeof useWorkerModelCatalog>;
  value: ModelSelection;
  label: string;
  disabled: boolean;
  onChange: (value: ModelSelection) => void;
}) {
  const entry = catalog.entries.find((candidate) => candidate.instanceId === value.instanceId);
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      <ProviderModelPicker
        environmentId={catalog.environmentId}
        activeInstanceId={value.instanceId}
        model={value.model}
        lockedProvider={null}
        instanceEntries={catalog.entries}
        modelOptionsByInstance={catalog.modelOptions}
        disabled={disabled}
        triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
        triggerAriaLabel={label}
        onInstanceModelChange={(instanceId, model) => {
          if (instanceId !== value.instanceId || model !== value.model)
            onChange({ instanceId, model });
        }}
      />
      {entry && (
        <TraitsPicker
          provider={entry.driverKind}
          instanceId={value.instanceId}
          models={entry.models}
          model={value.model}
          modelOptions={value.options}
          allowPromptInjectedEffort={false}
          planModeEnabled={catalog.planModeEnabled}
          triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
          onModelOptionsChange={(options) => {
            const { options: _previous, ...rest } = value;
            onChange(options === undefined ? rest : { ...rest, options });
          }}
        />
      )}
    </div>
  );
}

function CountSelect({
  label,
  unit,
  max,
  value,
  onChange,
}: {
  label: string;
  unit: [string, string];
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const options = Array.from({ length: max }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1} ${i === 0 ? unit[0] : unit[1]}`,
  }));
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => {
        if (next !== null) onChange(Number(next));
      }}
      items={options}
    >
      <SelectTrigger size="sm" aria-label={label} className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function ConfirmRow({
  title,
  description,
  action,
  confirmTitle,
  confirmDescription,
  confirmLabel,
  icon,
  busy,
  onConfirm,
}: {
  title: string;
  description: string;
  action: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  icon?: ReactNode;
  busy: boolean;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <AlertDialog
          open={open}
          onOpenChange={(value) => {
            if (!busy) setOpen(value);
          }}
        >
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
            {icon}
            {action}
          </Button>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose disabled={busy} render={<Button variant="outline" />}>
                Cancel
              </AlertDialogClose>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void onConfirm().then((done) => done && setOpen(false))}
              >
                {confirmLabel}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      }
    />
  );
}

function GladosSettings({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const query = useEnvironmentQuery(serverEnvironment.pitbossLive({ environmentId, input: {} }));
  const peers = useEnvironmentQuery(serverEnvironment.pitbossPeers({ environmentId, input: {} }));
  const mutate = useAtomCommand(serverEnvironment.pitbossCommand, { label: "GLaDOS settings" });
  const navigate = useNavigate();
  const { targets } = useSettingsScope();
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const projectName = (id: ProjectId) =>
    projects.find((project) => project.id === id)?.title ?? "Unavailable project";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Unsaved edits to the brief; null means the form shows the saved brief.
  const [draft, setDraft] = useState<PitbossBrief | null>(null);
  const state = query.data;
  const role = state?.role;
  const brief = draft ?? role?.brief;
  const saved = brief
    ? [brief.workerModel, ...(brief.alternateWorkerModel ? [brief.alternateWorkerModel] : [])]
    : [];
  const catalog = useWorkerModelCatalog(environmentId, saved);

  const command = async (action: PitbossAction) => {
    if (!state || busy) return false;
    setBusy(true);
    setError(null);
    const result = await mutate({
      environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        expectedRevision: state.revision,
        action,
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(String(squashAtomCommandFailure(result)));
      return false;
    }
    return true;
  };
  const openHome = async () => {
    // Activating an existing home restores its thread if needed before we open it.
    if (role && (await command({ type: "activate-home", brief: role.brief })))
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: role.threadId },
      });
  };
  const edit = (next: Partial<PitbossBrief>) => {
    if (brief) setDraft({ ...brief, ...next });
  };

  if (!state) {
    return (
      <SettingsSection title="GLaDOS">
        <SettingsRow
          title={query.error ? "GLaDOS is unavailable" : "Loading GLaDOS…"}
          description={query.error ? String(query.error) : undefined}
        />
      </SettingsSection>
    );
  }

  const errorRow = error ? (
    <p role="alert" className="px-3 text-sm text-destructive sm:px-4">
      {error}
    </p>
  ) : null;

  if (!role || !brief) {
    const setupModel =
      projects.find((project) => project.defaultModelSelection)?.defaultModelSelection ??
      catalog.available[0];
    const scopedProjectId = targets.find(
      (target) => target.environmentId === environmentId,
    )?.projectId;
    return (
      <SettingsSection title="GLaDOS" hideTitle>
        <SettingsRow
          title="GLaDOS is not set up"
          description={
            setupModel
              ? `An always-on coordinator on ${label} that plans work and runs agents for you.`
              : "Connect an available provider in Settings to set up GLaDOS."
          }
          control={
            <Button
              size="sm"
              disabled={busy || !setupModel}
              onClick={() => {
                if (!setupModel) return;
                void command({
                  type: "activate-home",
                  brief: defaultPitbossBrief({
                    workerModel: setupModel,
                    projectIds: scopedProjectId ? [scopedProjectId] : [],
                  }),
                });
              }}
            >
              <CrownIcon className="size-3.5" />
              Set up GLaDOS
            </Button>
          }
        />
        {errorRow}
      </SettingsSection>
    );
  }

  const working = state.tasks.filter(
    (task) => task.status === "active" || task.status === "verifying",
  ).length;
  const needsYou = state.tasks.filter((task) => workNeedsYou(task, state.awaitingApproval)).length;
  const autonomy = pitbossAutonomy(role.brief);
  const addableProjects = projects.filter((project) => !brief.projectIds.includes(project.id));
  const peerList = peers.data?.peers ?? [];
  const selectedPeerIds = brief.managedPeerIds ?? peerList.map((peer) => peer.config.id);
  const fallback =
    catalog.available.find(
      (candidate) =>
        candidate.instanceId !== brief.workerModel.instanceId ||
        candidate.model !== brief.workerModel.model,
    ) ?? catalog.available[0];

  return (
    <>
      <SettingsSection title="Status" hideTitle>
        <SettingsRow
          title={role.paused ? "GLaDOS is paused" : "GLaDOS is running"}
          description={`Home on ${label} · ${working} ${working === 1 ? "worker" : "workers"} active${needsYou ? ` · ${needsYou} ${needsYou === 1 ? "needs" : "need"} you` : ""}`}
          control={
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void command({ type: "pause", paused: !role.paused })}
              >
                {role.paused ? (
                  <PlayIcon className="size-3.5" />
                ) : (
                  <PauseIcon className="size-3.5" />
                )}
                {role.paused ? "Resume" : "Pause"}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void openHome()}>
                Open GLaDOS
              </Button>
            </>
          }
        />
        {errorRow}
      </SettingsSection>

      <SettingsSection title="Brief">
        <SettingsRow title="Priorities" description="What matters most, and what should wait.">
          <Textarea
            className="mb-2 mt-3"
            value={brief.priorities}
            disabled={busy}
            onChange={(event) => edit({ priorities: event.target.value })}
            placeholder="What matters most? What should wait?"
          />
        </SettingsRow>
        <SettingsRow title="Projects" description="Where GLaDOS may start work.">
          <div className="mb-2 mt-3 flex flex-wrap gap-2">
            {brief.projectIds.map((id) => (
              <span
                key={id}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm"
              >
                <FolderIcon className="size-3.5 text-muted-foreground" />
                {projectName(id)}
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={`Remove ${projectName(id)}`}
                  disabled={busy}
                  onClick={() =>
                    edit({ projectIds: brief.projectIds.filter((entry) => entry !== id) })
                  }
                >
                  <XIcon className="size-3" />
                </Button>
              </span>
            ))}
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || addableProjects.length === 0}
                  />
                }
              >
                <PlusIcon className="size-3.5" />
                Add project
              </MenuTrigger>
              <MenuPopup align="start">
                {addableProjects.map((project) => (
                  <MenuItem
                    key={project.id}
                    onClick={() => edit({ projectIds: [...brief.projectIds, project.id] })}
                  >
                    {project.title}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="How GLaDOS works">
        <SettingsRow
          title="Autonomy"
          description={
            autonomy === "full-auto"
              ? "Full auto: GLaDOS and its workers run without approval prompts and verify their own work."
              : autonomy === "ask"
                ? "Ask me: GLaDOS and its workers ask for approvals, and you review each new verification recipe."
                : "Custom permissions — pick one to simplify."
          }
          control={
            <ToggleGroup
              aria-label="Autonomy"
              variant="outline"
              size="sm"
              value={autonomy === "custom" ? [] : [autonomy]}
              disabled={busy}
              onValueChange={(values) => {
                const next = values[0];
                if (next !== "ask" && next !== "full-auto") return;
                void command({
                  type: "brief",
                  brief: withPitbossAutonomy(role.brief, next),
                  applyCoordinatorPermissions: true,
                });
                if (draft) setDraft(withPitbossAutonomy(draft, next));
              }}
            >
              <Toggle value="ask">Ask me</Toggle>
              <Toggle value="full-auto">Full auto</Toggle>
            </ToggleGroup>
          }
        />
        <SettingsRow
          title="Model"
          description="Used by workers GLaDOS starts."
          control={
            <WorkerModelPicker
              catalog={catalog}
              value={brief.workerModel}
              label="Worker model"
              disabled={busy}
              onChange={(workerModel) => edit({ workerModel })}
            />
          }
        />
        <Collapsible>
          <SettingsRow
            title="Advanced"
            description="Workers, attempts, quality bar, fallback model"
            control={
              <CollapsibleTrigger
                className="group"
                render={<Button size="sm" variant="ghost-muted" />}
              >
                {brief.maxWorkers} {brief.maxWorkers === 1 ? "worker" : "workers"} ·{" "}
                {brief.maxAttempts} {brief.maxAttempts === 1 ? "attempt" : "attempts"}
                <ChevronRightIcon className="size-4 group-data-panel-open:rotate-90" />
              </CollapsibleTrigger>
            }
          />
          <CollapsiblePanel>
            <SettingsRow
              title="Concurrent workers"
              description="Workers GLaDOS may run at once."
              control={
                <CountSelect
                  label="Concurrent workers"
                  unit={["worker", "workers"]}
                  max={10}
                  value={brief.maxWorkers}
                  onChange={(maxWorkers) => edit({ maxWorkers })}
                />
              }
            />
            <SettingsRow
              title="Attempts per task"
              description="Tries before GLaDOS asks you."
              control={
                <CountSelect
                  label="Attempts per task"
                  unit={["attempt", "attempts"]}
                  max={5}
                  value={brief.maxAttempts}
                  onChange={(maxAttempts) => edit({ maxAttempts })}
                />
              }
            />
            <SettingsRow title="Quality bar" description="Optional. What a good result looks like.">
              <Textarea
                className="mb-2 mt-3"
                value={brief.quality}
                disabled={busy}
                onChange={(event) => edit({ quality: event.target.value })}
              />
            </SettingsRow>
            <SettingsRow
              title="Fallback model"
              description="An alternative GLaDOS can choose for tasks that need a different strength."
              control={
                brief.alternateWorkerModel ? (
                  <>
                    <WorkerModelPicker
                      catalog={catalog}
                      value={brief.alternateWorkerModel}
                      label="Fallback model"
                      disabled={busy}
                      onChange={(alternateWorkerModel) => edit({ alternateWorkerModel })}
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost-muted"
                      aria-label="Remove fallback model"
                      disabled={busy}
                      onClick={() => {
                        const { alternateWorkerModel: _removed, ...rest } = brief;
                        setDraft(rest);
                      }}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !fallback}
                    onClick={() =>
                      fallback &&
                      edit({
                        alternateWorkerModel: fallback,
                        modelGuidance: brief.modelGuidance ?? PITBOSS_DEFAULT_MODEL_GUIDANCE,
                      })
                    }
                  >
                    <PlusIcon className="size-3.5" />
                    Add fallback
                  </Button>
                )
              }
            />
            {brief.alternateWorkerModel && (
              <SettingsRow
                title="How GLaDOS should choose"
                description="Which work suits each model."
              >
                <Textarea
                  className="mb-2 mt-3"
                  value={brief.modelGuidance ?? PITBOSS_DEFAULT_MODEL_GUIDANCE}
                  disabled={busy}
                  onChange={(event) => edit({ modelGuidance: event.target.value })}
                />
              </SettingsRow>
            )}
            {peerList.length >= 2 && (
              <SettingsRow
                title="Peers GLaDOS coordinates with"
                description="Shared work still needs approval on both environments."
              >
                <div className="mb-2 mt-3 grid gap-2">
                  {peerList.map((peer) => (
                    <label key={peer.config.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedPeerIds.includes(peer.config.id)}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          edit({
                            managedPeerIds: checked
                              ? [...selectedPeerIds, peer.config.id]
                              : selectedPeerIds.filter((id) => id !== peer.config.id),
                          })
                        }
                      />
                      {peer.config.id}
                    </label>
                  ))}
                </div>
              </SettingsRow>
            )}
          </CollapsiblePanel>
        </Collapsible>
      </SettingsSection>

      {draft && (
        <div className="sticky bottom-4 z-10 flex items-center gap-2 rounded-xl border border-border bg-popover px-4 py-2 shadow-lg">
          <span className="flex-1 text-sm text-muted-foreground">Unsaved changes to the brief</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void command({ type: "brief", brief: draft }).then((done) => done && setDraft(null))
            }
          >
            Save
          </Button>
        </div>
      )}

      <SettingsSection title="Connections">
        <PitbossSources
          environmentId={environmentId}
          projectIds={role.brief.projectIds}
          projectName={projectName}
        />
        <PitbossPeers environmentId={environmentId} tasks={state.tasks} onCommand={command} />
      </SettingsSection>

      <SettingsSection title="Danger zone" hideTitle>
        <ConfirmRow
          title="Reset GLaDOS"
          description="Close all open work and start a fresh home thread. Brief and connections are kept."
          action="Reset…"
          icon={<RotateCcwIcon className="size-3.5" />}
          confirmTitle="Reset GLaDOS?"
          confirmDescription="Open work on this environment is cancelled and GLaDOS starts over in a fresh home thread. The old home thread is archived. Your brief and connections are kept."
          confirmLabel="Reset GLaDOS"
          busy={busy}
          onConfirm={() => command({ type: "reset" })}
        />
        <ConfirmRow
          title="Dismiss GLaDOS"
          description="Stop coordinating on this environment. You can set it up again later."
          action="Dismiss…"
          confirmTitle="Dismiss GLaDOS?"
          confirmDescription="GLaDOS stops coordinating work on this environment. Its work history stays, and you can set it up again here at any time."
          confirmLabel="Dismiss GLaDOS"
          busy={busy}
          onConfirm={() => command({ type: "dismiss" })}
        />
      </SettingsSection>
    </>
  );
}
