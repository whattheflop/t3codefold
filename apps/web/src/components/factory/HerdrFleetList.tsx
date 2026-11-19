import type { CoreAgent } from "@t3tools/client-runtime/herdr/protocol";
import { CircleDashedIcon, CircleOffIcon, MessageCircleQuestionIcon, PinIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { herdrAgentStatus } from "./herdrAgentStatus";

const STATUS_ICONS = {
  working: CircleDashedIcon,
  input: MessageCircleQuestionIcon,
  exited: CircleOffIcon,
} as const;

interface FleetNode {
  readonly agent: CoreAgent;
  readonly depth: number;
}

/** Agents in parent order: each agent's children follow it, pinned roots first. */
export function orderFleet(agents: readonly CoreAgent[], pins: readonly string[]): FleetNode[] {
  const ids = new Set(agents.map((agent) => agent.id));
  const children = new Map<string | null, CoreAgent[]>();
  for (const agent of agents) {
    const parent = agent.parentId && ids.has(agent.parentId) ? agent.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), agent]);
  }
  const byPinThenLabel = (a: CoreAgent, b: CoreAgent) =>
    Number(pins.includes(b.id)) - Number(pins.includes(a.id)) || a.label.localeCompare(b.label);
  const ordered: FleetNode[] = [];
  const visit = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const agent of [...(children.get(parent) ?? [])].sort(byPinThenLabel)) {
      if (seen.has(agent.id)) continue;
      seen.add(agent.id);
      ordered.push({ agent, depth });
      visit(agent.id, depth + 1, seen);
    }
  };
  const seen = new Set<string>();
  visit(null, 0, seen);
  // A parent cycle has no root to start from; show its members at the top level.
  for (const agent of [...agents].sort(byPinThenLabel)) {
    if (seen.has(agent.id)) continue;
    seen.add(agent.id);
    ordered.push({ agent, depth: 0 });
    visit(agent.id, 1, seen);
  }
  return ordered;
}

export interface FleetGroup {
  readonly tab: string | null;
  readonly nodes: readonly FleetNode[];
}

/** Agents grouped by Herdr tab in Core's order, each tab nested by parent. */
export function groupFleet(agents: readonly CoreAgent[], pins: readonly string[]): FleetGroup[] {
  const tabs = new Map<string | null, CoreAgent[]>();
  for (const agent of agents) tabs.set(agent.tab, [...(tabs.get(agent.tab) ?? []), agent]);
  return [...tabs].map(([tab, members]) => ({ tab, nodes: orderFleet(members, pins) }));
}

/** Sidebar rows styled like T3's slim thread rows, indented under their parent agent. */
export function HerdrFleetList({
  nodes,
  activeId,
  pins,
  disabled,
  onSelect,
}: {
  readonly nodes: readonly FleetNode[];
  readonly activeId: string | null;
  readonly pins: readonly string[];
  readonly disabled: boolean;
  readonly onSelect: (agent: CoreAgent) => void;
}) {
  return (
    <ul className="flex flex-col gap-px px-2" aria-label="Factory agents">
      {nodes.map(({ agent, depth }) => {
        const status = herdrAgentStatus(agent);
        const StatusIcon = status ? STATUS_ICONS[status.kind] : null;
        const active = agent.id === activeId;
        return (
          <li key={agent.id}>
            <button
              type="button"
              disabled={disabled}
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(agent)}
              style={{ paddingInlineStart: `${0.625 + depth * 1}rem` }}
              className={cn(
                "group/sidebar-row relative flex h-9 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-md pe-2.5 text-left text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default",
                active
                  ? "bg-sidebar-row-active text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
                  : status?.kind === "exited"
                    ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                    : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
              )}
            >
              {pins.includes(agent.id) ? (
                <PinIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{agent.label}</span>
              {status && StatusIcon ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 text-xs font-medium",
                    status.className,
                  )}
                >
                  <StatusIcon aria-hidden className="size-3 shrink-0" />
                  {status.label}
                </span>
              ) : agent.role ? (
                <span className="shrink-0 text-xs text-secondary-label">{agent.role}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
