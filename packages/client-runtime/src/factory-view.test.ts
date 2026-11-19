import { EnvironmentId, type FactoryAgent, type FactoryCard } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  factoryAgentRows,
  openFactoryCards,
  recentFactoryAnswers,
  selectFactoryTarget,
} from "./factory-view.ts";

const agent = (id: string, parentId: string | null, lifecycle = "active") =>
  ({ id, parentId, lifecycle }) as FactoryAgent;
const card = (id: string, blocking: boolean, urgency: string, createdAt: number, state = "open") =>
  ({ id, state, createdAt, body: { blocking, urgency } }) as FactoryCard;

describe("Factory queue presentation", () => {
  it("prioritizes blocking decisions, then urgency, then oldest within each priority", () => {
    const cards = [
      card("later", false, "this-week", 0),
      card("new", true, "now", 5),
      card("today", true, "today", 1),
      card("old", true, "now", 2),
      card("done", true, "now", 0, "answered"),
    ];
    expect(openFactoryCards(cards).map((item) => item.id)).toEqual([
      "old",
      "new",
      "today",
      "later",
    ]);
    expect(cards.map((item) => item.id)).toEqual(["later", "new", "today", "old", "done"]);
  });
  it("places descendants beneath their parent even when input is unordered", () => {
    expect(
      factoryAgentRows([
        agent("worker", "lead"),
        agent("commander", null),
        agent("lead", "commander"),
      ]).map(({ agent: item, depth }) => [item.id, depth]),
    ).toEqual([
      ["commander", 0],
      ["lead", 1],
      ["worker", 2],
    ]);
  });
  it("keeps orphaned and cyclic ownership visible exactly once, without closed agents", () => {
    const rows = factoryAgentRows([
      agent("a", "b"),
      agent("b", "a"),
      agent("orphan", "gone"),
      agent("closed", null, "closed"),
      agent("child", "closed"),
    ]);
    expect(rows.map(({ agent: item }) => item.id).sort()).toEqual(["a", "b", "child", "orphan"]);
    expect(rows.find(({ agent: item }) => item.id === "child")?.depth).toBe(0);
  });
});

it("keeps a newly answered low-ID card in the most recent twelve answers", () => {
  const cards = Array.from({ length: 14 }, (_, index) => ({
    ...card(String.fromCharCode(97 + index), false, "today", 0, "answered"),
    answeredAt: index === 0 ? 100 : index,
    updatedAt: index,
  }));
  const recent = recentFactoryAnswers(cards);
  expect(recent).toHaveLength(12);
  expect(recent[0]?.id).toBe("a");
  expect(recent.map((item) => item.id)).not.toContain("b");
});

describe("Factory server selection", () => {
  const local = { environmentId: EnvironmentId.make("desktop"), label: "Desktop" };
  const remote = { environmentId: EnvironmentId.make("remote"), label: "Remote" };
  const environments = [local, remote];

  it("keeps an explicit server selected when the catalog reorders and never falls back when removed", () => {
    expect(selectFactoryTarget(environments, remote.environmentId).environment).toBe(remote);
    expect(selectFactoryTarget([remote, local], remote.environmentId).environment).toBe(remote);
    expect(selectFactoryTarget([local], remote.environmentId).environment).toBeUndefined();
    expect(selectFactoryTarget(environments, null).environment).toBe(local);
  });

  it("shows a linked decision only in its own server when switching inboxes", () => {
    const destination = { environmentId: remote.environmentId, cardId: "same-id" };
    expect(selectFactoryTarget(environments, null, destination)).toEqual({
      environment: remote,
      cardId: "same-id",
    });
    expect(selectFactoryTarget(environments, local.environmentId, destination)).toEqual({
      environment: local,
      cardId: undefined,
    });
    expect(selectFactoryTarget([local], null, destination)).toEqual({
      environment: undefined,
      cardId: undefined,
    });
  });
});
