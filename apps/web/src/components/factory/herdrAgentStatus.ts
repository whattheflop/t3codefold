import type { CoreAgent } from "@t3tools/client-runtime/herdr/protocol";

export interface HerdrAgentStatus {
  readonly kind: "working" | "input" | "exited";
  readonly label: string;
  readonly className: string;
}

/** Herdr's terminal state in the sidebar's status vocabulary; idle shows nothing, as in T3. */
export function herdrAgentStatus(agent: CoreAgent): HerdrAgentStatus | null {
  if (agent.processState !== "live") {
    return { kind: "exited", label: "Exited", className: "text-muted-foreground" };
  }
  if (agent.status === "working") {
    return { kind: "working", label: "Working", className: "text-info-foreground" };
  }
  if (agent.status === "blocked" || agent.status === "waiting") {
    return { kind: "input", label: "Input", className: "text-indigo-600 dark:text-indigo-300" };
  }
  return null;
}
