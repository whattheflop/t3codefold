import type { EnvironmentId, FactoryAgent, FactoryCard } from "@t3tools/contracts";

const URGENCY = { now: 0, today: 1, "this-week": 2 };

export function openFactoryCards(cards: readonly FactoryCard[]) {
  return cards
    .filter((card) => card.state === "open")
    .sort(
      (a, b) =>
        Number(b.body.blocking) - Number(a.body.blocking) ||
        URGENCY[a.body.urgency] - URGENCY[b.body.urgency] ||
        a.createdAt - b.createdAt,
    );
}

export function factoryAgentRows(agents: readonly FactoryAgent[]) {
  const visible = agents.filter((agent) => agent.lifecycle !== "closed");
  const ids = new Set(visible.map((agent) => agent.id));
  const visited = new Set<string>();
  const rows: { agent: FactoryAgent; depth: number }[] = [];
  const children = new Map<string | null, FactoryAgent[]>();
  for (const agent of visible) {
    const parent = agent.parentId && ids.has(agent.parentId) ? agent.parentId : null;
    const group = children.get(parent) ?? [];
    group.push(agent);
    children.set(parent, group);
  }
  const visit = (agent: FactoryAgent, depth: number) => {
    if (visited.has(agent.id)) return;
    visited.add(agent.id);
    rows.push({ agent, depth });
    for (const child of children.get(agent.id) ?? []) visit(child, depth + 1);
  };
  for (const agent of children.get(null) ?? []) visit(agent, 0);
  // Preserve visibility when stale ownership contains a cycle.
  for (const agent of visible) visit(agent, 0);
  return rows;
}

export const FACTORY_CARD_KIND_LABEL = {
  decision: "Decision",
  housekeeping: "Housekeeping",
  "fyi-chose": "Agent chose · FYI",
} as const;

export function recentFactoryAnswers(cards: readonly FactoryCard[]) {
  return cards
    .filter((card) => card.state === "answered" || card.state === "acked")
    .sort(
      (a, b) =>
        (b.answeredAt ?? b.updatedAt) - (a.answeredAt ?? a.updatedAt) || a.id.localeCompare(b.id),
    )
    .slice(0, 12);
}

/** Explicit destinations never fall back to another server or carry its decision link. */
export function selectFactoryTarget<T extends { readonly environmentId: EnvironmentId }>(
  environments: readonly T[],
  selected: EnvironmentId | null,
  destination: { readonly environmentId?: EnvironmentId; readonly cardId?: string } = {},
) {
  const requested = selected ?? destination.environmentId;
  const environment = requested
    ? environments.find((item) => item.environmentId === requested)
    : environments[0];
  return {
    environment,
    cardId:
      environment && environment.environmentId === destination.environmentId
        ? destination.cardId
        : undefined,
  };
}
