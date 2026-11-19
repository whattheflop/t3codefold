import { FactoryError, type FactoryAgent, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { FactoryStore } from "./FactoryStore.ts";

export type FactoryActor =
  | { readonly kind: "user" }
  | { readonly kind: "agent"; readonly threadId: ThreadId };

export const callerAgent = Effect.fn("Factory.callerAgent")(function* (actor: FactoryActor) {
  if (actor.kind !== "agent") return yield* new FactoryError({ code: "forbidden" });
  const store = yield* FactoryStore;
  const agent = (yield* store.list("agents")).find((a) => a.threadId === actor.threadId);
  if (agent === undefined || agent.lifecycle === "closed" || agent.lifecycle === "retired")
    return yield* new FactoryError({ code: "forbidden" });
  return agent;
});

export function inSubtree(
  root: FactoryAgent,
  target: FactoryAgent,
  agents: ReadonlyArray<FactoryAgent>,
): boolean {
  const visited = new Set<string>();
  let current: FactoryAgent | undefined = target;
  while (current !== undefined && !visited.has(current.id)) {
    if (current.id === root.id) return true;
    visited.add(current.id);
    current = agents.find((a) => a.id === current?.parentId);
  }
  return false;
}

export const requireAgentControl = Effect.fn("Factory.requireAgentControl")(function* (
  actor: FactoryActor,
  id: string,
) {
  const store = yield* FactoryStore;
  const target = yield* store.get("agents", id);
  if (!target) return yield* new FactoryError({ code: "not-found", entityId: id });
  if (actor.kind === "user") return target;
  const caller = yield* callerAgent(actor);
  if (!inSubtree(caller, target, yield* store.list("agents")))
    return yield* new FactoryError({ code: "forbidden" });
  return target;
});
