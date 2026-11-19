import { T, Var, useGT, msg } from "gt-react";
import { m } from "~/i18n/messages";
import type { DesktopHerdrAttachInput } from "@t3tools/contracts";
import { EyeIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState } from "react";

import {
  resolveTerminalFontPreference,
  resolveTerminalFontSizePreference,
  TYPOGRAPHY_ADVANCED_STORAGE_KEY,
} from "../../appearanceFonts";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useClientSettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
import { randomUUID } from "~/lib/utils";
import { GhosttyTerminalSurface } from "../../terminal/ghostty/surface";
import { terminalThemeFromApp } from "../ThreadTerminalDrawer";
import { Button } from "../ui/button";

export interface HerdrAttachTarget {
  readonly socketPath: string;
  readonly sshHost?: string | undefined;
  readonly coreId: string;
}

type PaneStatus =
  | { readonly kind: "connecting" }
  | { readonly kind: "open" }
  | { readonly kind: "closed"; readonly reason: string };

const fontOptions = (family: string, size: number) =>
  family.trim().length > 0 ? { family: family.trim(), size } : { size };

const hex = ({ r, g, b }: { readonly r: number; readonly g: number; readonly b: number }) =>
  `#${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;

/**
 * A live Herdr terminal, like `hc attach`: Core streams the program's bytes into T3's Ghostty
 * surface, and keys, mouse, paste and size go straight back. Read-only connections only watch.
 */
export function HerdrPaneView(props: PaneProps) {
  const [attempt, setAttempt] = useState(0);
  if (!window.desktopBridge?.herdrAttach)
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <T>Live terminals need the desktop app.</T>
      </div>
    );
  return <LivePane key={attempt} {...props} onReconnect={() => setAttempt(attempt + 1)} />;
}

interface PaneProps {
  readonly target: HerdrAttachTarget;
  readonly terminal: string;
  readonly label: string;
  readonly readOnly: boolean;
}

function LivePane({
  target,
  terminal,
  label,
  readOnly,
  onReconnect,
}: PaneProps & { readonly onReconnect: () => void }) {
  const gt = useGT();
  const mountRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<GhosttyTerminalSurface | null>(null);
  const [status, setStatus] = useState<PaneStatus>({ kind: "connecting" });
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const fontFamily = useClientSettings((settings) =>
    resolveTerminalFontPreference({
      advanced: advancedTypography,
      code: settings.fontFamilyCode,
      terminal: settings.fontFamilyTerminal,
    }),
  );
  const fontSize = useClientSettings((settings) =>
    resolveTerminalFontSizePreference({
      advanced: advancedTypography,
      code: settings.fontSizeCode,
      terminal: settings.fontSizeTerminal,
    }),
  );
  const fontRef = useRef({ family: fontFamily, size: fontSize });
  const { socketPath, sshHost, coreId } = target;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies font settings to the live Ghostty surface
  useEffect(() => {
    fontRef.current = { family: fontFamily, size: fontSize };
    void surfaceRef.current?.setFont(fontOptions(fontFamily, fontSize));
  }, [fontFamily, fontSize]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the Ghostty surface and the Core attach stream behind it
  useEffect(() => {
    const mount = mountRef.current;
    const bridge = window.desktopBridge?.herdrAttach;
    if (!mount || !bridge) return;
    const streamId = randomUUID();
    const decoder = new TextDecoder();
    let disposed = false;
    let opened = false;
    let surface: GhosttyTerminalSurface | null = null;
    const send = (input: DesktopHerdrAttachInput) => {
      void bridge.input(input).catch(() => undefined);
    };
    const unsubscribe = bridge.onEvent((event) => {
      if (event.streamId !== streamId) return;
      if (event.type === "data") surface?.write(decoder.decode(event.data, { stream: true }));
      else if (event.type === "resize")
        surface?.setSharedGrid({ cols: event.cols, rows: event.rows });
      else {
        opened = false;
        setStatus({ kind: "closed", reason: closedReason(event.reason) });
      }
    });
    const onFocus = () => opened && !readOnly && send({ streamId, type: "focus", focused: true });
    const onBlur = () => opened && !readOnly && send({ streamId, type: "focus", focused: false });
    const themeObserver = new MutationObserver(() =>
      surface?.setTheme(terminalThemeFromApp(mount)),
    );
    void GhosttyTerminalSurface.create(mount, {
      theme: terminalThemeFromApp(mount),
      font: fontOptions(fontRef.current.family, fontRef.current.size),
      onData: (data) => {
        if (opened && !readOnly) send({ streamId, type: "data", data });
      },
      onBinary: (data) => {
        if (opened && !readOnly) send({ streamId, type: "data", data, encoding: "binary" });
      },
      onReply: (data) => {
        if (opened && !readOnly) send({ streamId, type: "data", data });
      },
      onResize: (cols, rows) => {
        if (opened && !readOnly) send({ streamId, type: "resize", cols, rows });
      },
      onSelectionChange: () => {},
      beforeKey: () => true,
      onLinkActivate: (url) => {
        if (/^https?:\/\//i.test(url)) void ensureLocalApi().shell.openExternal(url);
      },
    })
      .then(async (created) => {
        if (disposed) {
          created.dispose();
          return;
        }
        surface = created;
        surfaceRef.current = created;
        created.input.readOnly = readOnly;
        created.input.addEventListener("focus", onFocus);
        created.input.addEventListener("blur", onBlur);
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
        created.fit();
        const theme = terminalThemeFromApp(mount);
        await bridge.open({
          streamId,
          expectedCoreId: coreId,
          socketPath,
          ...(sshHost ? { sshHost } : {}),
          terminal,
          observe: readOnly,
          cols: Math.max(created.cols, 20),
          rows: Math.max(created.rows, 5),
          display: {
            fg: hex(theme.foreground),
            bg: hex(theme.background),
            cursor: hex(theme.cursor),
          },
        });
        if (disposed) {
          send({ streamId, type: "close" });
          return;
        }
        opened = true;
        setStatus({ kind: "open" });
        if (!readOnly) created.focus();
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setStatus({
            kind: "closed",
            reason: closedReason(cause instanceof Error ? cause.message : ""),
          });
      });
    return () => {
      disposed = true;
      unsubscribe();
      themeObserver.disconnect();
      if (opened) send({ streamId, type: "close" });
      surface?.input.removeEventListener("focus", onFocus);
      surface?.input.removeEventListener("blur", onBlur);
      surface?.dispose();
      if (surfaceRef.current === surface) surfaceRef.current = null;
    };
  }, [socketPath, sshHost, coreId, terminal, readOnly]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <div
        ref={mountRef}
        data-herdr-terminal=""
        aria-label={gt("{label} terminal", { label })}
        className="relative min-h-0 flex-1 overflow-hidden"
      />
      {readOnly && status.kind === "open" ? (
        <span className="pointer-events-none absolute top-2 right-4 flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          <EyeIcon className="size-3" />
          <T>Watching</T>
        </span>
      ) : null}
      {status.kind !== "open" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground">
          {status.kind === "connecting" ? (
            <p role="status">
              <T>
                Attaching to <Var name="terminal">{label}</Var>…
              </T>
            </p>
          ) : (
            <>
              <p role="alert">{status.reason}</p>
              <Button size="sm" variant="outline" onClick={onReconnect}>
                <T>Reconnect</T>
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function closedReason(reason: string) {
  // Electron prefixes invoke failures with its own channel and error name.
  const message = reason.replace(/^Error invoking remote method '[^']+': (\w+: )?/, "").trim();
  if (message === "" || message === "ended") return m(msg("The terminal stream ended."));
  if (message === "detached") return m(msg("Detached from the terminal."));
  return message;
}
