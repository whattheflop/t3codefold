import { useAtomValue } from "@effect/atom-react";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { Atom } from "effect/reactivity";
import { msg } from "gt-react";
import { m } from "~/i18n/messages";
import { environmentAtomList, environmentIdsKey } from "~/state/environmentAtomList";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useRef } from "react";
import { useClientSettings } from "../../hooks/useSettings";
import { useEnvironments } from "../../state/environments";
import { environmentShell } from "../../state/shell";
import { summarizeGamingHudThreads } from "./gamingHud.logic";

import { stackedThreadToast, toastManager } from "../ui/toast";

const hudSummary = Atom.family((id: EnvironmentId) =>
  Atom.make((get) => {
    const shell = get(environmentShell.stateValueAtom(id));
    const connected = shell.status === "live" && Option.isSome(shell.snapshot);
    const threads =
      connected && Option.isSome(shell.snapshot)
        ? shell.snapshot.value.threads.map((thread) => presentThreadShell(id, thread))
        : [];
    return { connected, ...summarizeGamingHudThreads(threads) };
  }),
);
const hudEnvironments = environmentAtomList("gaming-hud", hudSummary);

export function GamingHudCoordinator() {
  const enabled = useClientSettings((settings) => settings.gamingHudEnabled);
  const position = useClientSettings((settings) => settings.gamingHudPosition);
  const { environments } = useEnvironments();
  const summaries = useAtomValue(
    hudEnvironments(enabled ? environmentIdsKey(environments.map((env) => env.environmentId)) : ""),
  );
  const reportedFailure = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Send current visibility, position and thread counts to the native overlay.
  useEffect(() => {
    if (!enabled) reportedFailure.current = false;
    void window.desktopBridge
      ?.setGamingHud?.({
        enabled,
        position,
        environments: summaries,
      })
      .catch(() => {
        if (!enabled || reportedFailure.current) return;
        reportedFailure.current = true;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: m(msg("Could not show Gaming HUD")),
            description: m(msg("Try turning Gaming HUD off and on again in Settings → General.")),
          }),
        );
      });
  }, [enabled, position, summaries]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Close the Electron overlay when this renderer unmounts.
  useEffect(
    () => () => {
      void window.desktopBridge
        ?.setGamingHud?.({ enabled: false, position: "top-right", environments: [] })
        .catch(() => undefined);
    },
    [],
  );
  return null;
}
