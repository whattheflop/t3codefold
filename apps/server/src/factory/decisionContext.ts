import type { FactoryAgent, FactoryCard, FactoryWake } from "@t3tools/contracts";
import { inSubtree } from "./access.ts";

const brief = (text: string | null) => text?.slice(0, 120) ?? null;

function section(title: string, rows: ReadonlyArray<unknown>, budget: number): string {
  const lines: string[] = [];
  let remaining = budget;
  for (const row of rows) {
    const line = JSON.stringify(row);
    if (line.length + 1 > remaining) break;
    lines.push(line);
    remaining -= line.length + 1;
  }
  return `${title} (${rows.length} total; ${lines.length} shown)\n${lines.join("\n")}`;
}

export function factoryDecisionContext(
  agent: FactoryAgent,
  agents: ReadonlyArray<FactoryAgent>,
  cards: ReadonlyArray<FactoryCard>,
  wakes: ReadonlyArray<FactoryWake>,
): string {
  const visible = agents.filter((candidate) => inSubtree(agent, candidate, agents));
  const ids = new Set(visible.map((candidate) => candidate.id));
  const owned = cards.filter((card) => ids.has(card.ownerId));
  const urgency = { now: 0, today: 1, "this-week": 2 };
  const open = owned
    .filter((card) => card.state === "open")
    .sort(
      (left, right) =>
        Number(right.body.blocking) - Number(left.body.blocking) ||
        urgency[left.body.urgency] - urgency[right.body.urgency] ||
        right.updatedAt - left.updatedAt,
    );
  const answered = owned
    .filter((card) => card.state === "answered")
    .sort((left, right) => (right.answeredAt ?? 0) - (left.answeredAt ?? 0));
  const pending = wakes.filter(
    (wake) => wake.targetId === agent.id && !["acked", "cancelled"].includes(wake.state),
  );
  return [
    `Current work: ${JSON.stringify({ needs: brief(agent.needs), next: brief(agent.next) })}`,
    "Summaries are bounded. Read factory_board and factory_card_show for full context before acting; an answer records direction, not proof of completion.",
    section(
      "Open decisions",
      open.map((card) => ({
        id: card.id,
        revision: card.revision,
        owner: card.ownerId,
        title: card.body.title,
        blocking: card.body.blocking,
        urgency: card.body.urgency,
        ...Object.fromEntries(
          Object.entries(card.body.context).map(([key, value]) => [key, brief(value)]),
        ),
        recommendation: brief(card.body.options.find((option) => option.recommended)?.label ?? ""),
        rationale: brief(card.body.rationale),
        evidence: card.body.links.slice(0, 2).map((link) => brief(link.ref)),
      })),
      1800,
    ),
    section(
      "Recent user answers",
      answered.map((card) => {
        const selected = card.body.options.find((option) => option.id === card.optionId);
        return {
          id: card.id,
          revision: card.revision,
          owner: card.ownerId,
          outcome: card.outcome,
          selected: selected?.label,
          nextStep: brief(selected?.nextStep ?? ""),
          consequences: brief(selected?.consequences ?? ""),
          note: brief(card.note),
        };
      }),
      1300,
    ),
    section(
      "Managed agents",
      visible
        .filter(
          (candidate) =>
            candidate.id !== agent.id && !["closed", "retired"].includes(candidate.lifecycle),
        )
        .sort((left, right) => Number(Boolean(right.needs)) - Number(Boolean(left.needs)))
        .map((candidate) => ({
          id: candidate.id,
          lifecycle: candidate.lifecycle,
          needs: brief(candidate.needs),
          next: brief(candidate.next),
        })),
      800,
    ),
    section(
      "Pending wakes",
      pending.map((wake) => ({
        id: wake.id,
        refKind: wake.refKind,
        refId: wake.refId,
        state: wake.state,
      })),
      400,
    ),
  ].join("\n\n");
}
