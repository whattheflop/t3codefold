import { FactoryError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Factory from "../../../factory/Factory.ts";
import type { FactoryActor } from "../../../factory/access.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import * as Access from "../../McpToolAccess.ts";
import { FactoryToolkit } from "./tools.ts";

const caller = Effect.gen(function* () {
  const scope = yield* Invocation.McpInvocationContext;
  const actor: FactoryActor = scope.thread
    ? { kind: "agent", threadId: scope.thread.threadId }
    : { kind: "user" };
  return { factory: yield* Factory.Factory, actor };
});

export const layer = Access.toLayer(FactoryToolkit, {
  factory_board: Access.reads(() =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.board(actor);
    }),
  ),
  factory_trigger_list: Access.reads(() =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.board(actor);
    }),
  ),
  factory_card_show: Access.reads((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      const card = (yield* factory.board(actor)).cards.find((c) => c.id === input.cardId);
      if (!card) return yield* new FactoryError({ code: "not-found", entityId: input.cardId });
      return card;
    }),
  ),
  factory_spawn: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.agents.spawn(actor, input);
    }),
  ),
  factory_agent_update: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.agents.update(actor, input);
    }),
  ),
  factory_card_file: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.decisions.file(actor, input);
    }),
  ),
  factory_card_withdraw: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.decisions.withdraw(actor, input.cardId);
    }),
  ),
  factory_payload_put: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.decisions.payload(actor, input);
    }),
  ),
  factory_execute_action: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.actions.execute(actor, input.cardId);
    }),
  ),
  factory_ack: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.wakes.acknowledge(actor, input.refKind, input.refId);
    }),
  ),
  factory_defer: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.wakes.defer(actor, input.wakeId, input.until);
    }),
  ),
  factory_trigger_upsert: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.triggers.upsert(actor, input);
    }),
  ),
  factory_trigger_run: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return yield* factory.runTrigger(actor, input.id);
    }),
  ),
  factory_run_heavy: Access.writes((input) =>
    Effect.gen(function* () {
      const { factory, actor } = yield* caller;
      return {
        job: yield* factory.lanes.enqueue(actor, input),
        next: "Completion wakes this thread. End your turn; do not poll.",
      };
    }),
  ),
});
