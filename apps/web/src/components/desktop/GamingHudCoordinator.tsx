import { useAtomValue } from "@effect/atom-react";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, GamingHudState } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClientSettings } from "../../hooks/useSettings";
import { useEnvironments } from "../../state/environments";
import { environmentShell } from "../../state/shell";
import { summarizeGamingHudThreads } from "./gamingHud.logic";

import { stackedThreadToast, toastManager } from "../ui/toast";

type HudEnvironment = GamingHudState["environments"][number];

export function GamingHudCoordinator() {
  const enabled = useClientSettings((settings) => settings.gamingHudEnabled);
  const position = useClientSettings((settings) => settings.gamingHudPosition);
  const { environments } = useEnvironments();
  const [summaries, setSummaries] = useState(new Map<EnvironmentId, HudEnvironment>());
  const reportedFailure = useRef(false);
  const report = useCallback((id: EnvironmentId, summary: HudEnvironment) => {
    setSummaries((previous) => new Map(previous).set(id, summary));
  }, []);
  useEffect(() => {
    if (!enabled) reportedFailure.current = false;
    void window.desktopBridge
      ?.setGamingHud?.({
        enabled,
        position,
        environments: environments.map(
          (environment) =>
            summaries.get(environment.environmentId) ?? {
              connected: false,
              running: 0,
              waiting: 0,
              attentionCount: 0,
            },
        ),
      })
      .catch(() => {
        if (!enabled || reportedFailure.current) return;
        reportedFailure.current = true;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not show Gaming HUD",
            description: "Try turning Gaming HUD off and on again in Settings → General.",
          }),
        );
      });
  }, [enabled, position, environments, summaries]);
  useEffect(
    () => () => {
      void window.desktopBridge
        ?.setGamingHud?.({ enabled: false, position: "top-right", environments: [] })
        .catch(() => undefined);
    },
    [],
  );
  if (!enabled) return null;
  return environments.map((environment) => (
    <EnvironmentHud
      key={environment.environmentId}
      environmentId={environment.environmentId}
      report={report}
    />
  ));
}

function EnvironmentHud({
  environmentId,
  report,
}: {
  environmentId: EnvironmentId;
  report: (id: EnvironmentId, summary: HudEnvironment) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  useEffect(() => {
    const connected = shell.status === "live" && Option.isSome(shell.snapshot);
    const threads =
      connected && Option.isSome(shell.snapshot)
        ? shell.snapshot.value.threads.map((thread) => presentThreadShell(environmentId, thread))
        : [];
    report(environmentId, { connected, ...summarizeGamingHudThreads(threads) });
  }, [shell, environmentId, report]);
  return null;
}
