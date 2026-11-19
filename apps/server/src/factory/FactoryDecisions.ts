import {
  FactoryError,
  validateFactoryCard,
  type FactoryAnswerInput,
  type FactoryCard,
  type FactoryCardFileInput,
  type FactoryActionEnvelope,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FactoryControl } from "./FactoryControl.ts";
import { FactoryStore } from "./FactoryStore.ts";
import { WakeQueue } from "./WakeQueue.ts";
import { callerAgent, type FactoryActor } from "./access.ts";

export function canonicalAction(value: FactoryActionEnvelope): string {
  const ordered = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(ordered)
      : input !== null && typeof input === "object"
        ? Object.fromEntries(
            Object.entries(input)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, ordered(v)]),
          )
        : input;
  return JSON.stringify(ordered(value));
}

export class FactoryDecisions extends Context.Service<
  FactoryDecisions,
  {
    readonly file: (
      actor: FactoryActor,
      input: typeof FactoryCardFileInput.Type,
    ) => Effect.Effect<FactoryCard, FactoryError>;
    readonly answer: (
      actor: FactoryActor,
      input: FactoryAnswerInput,
    ) => Effect.Effect<FactoryCard, FactoryError>;
    readonly withdraw: (
      actor: FactoryActor,
      cardId: string,
    ) => Effect.Effect<FactoryCard, FactoryError>;
    readonly payload: (
      actor: FactoryActor,
      envelope: FactoryActionEnvelope,
    ) => Effect.Effect<string, FactoryError>;
  }
>()("t3/factory/FactoryDecisions") {}

const make = Effect.gen(function* () {
  const store = yield* FactoryStore;
  const control = yield* FactoryControl;
  const wakes = yield* WakeQueue;
  const digests = yield* Digest.Digest;
  const actorAgent = Effect.fn("FactoryDecisions.actorAgent")((actor: FactoryActor) =>
    callerAgent(actor).pipe(Effect.provideService(FactoryStore, store)),
  );
  const file: FactoryDecisions["Service"]["file"] = Effect.fn("FactoryDecisions.file")(
    (actor, input) =>
      store.transaction(
        Effect.gen(function* () {
          yield* control.requireEnabled;
          const owner = yield* actorAgent(actor);
          if (!validateFactoryCard(input.body))
            return yield* new FactoryError({ code: "invalid", entityId: input.id });
          const existing = yield* store.get("cards", input.id);
          if (
            existing &&
            (existing.ownerId !== owner.id ||
              existing.revision !== input.expectedRevision ||
              existing.state !== "open")
          )
            return yield* new FactoryError({ code: "conflict", entityId: input.id });
          if (input.body.action) {
            const payload = yield* store.get("payloads", input.body.action.payloadSha256);
            if (!payload || payload.ownerId !== owner.id)
              return yield* new FactoryError({ code: "invalid", entityId: input.id });
          }
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          if (existing) yield* wakes.revokeSource(`card:${existing.id}:${existing.revision}`);
          return yield* store.put("cards", {
            id: input.id,
            version: existing?.version ?? 0,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            authorId: existing?.authorId ?? owner.id,
            ownerId: owner.id,
            revision: (existing?.revision ?? 0) + 1,
            body: input.body,
            state: "open",
            outcome: null,
            optionId: null,
            note: "",
            answeredAt: null,
          });
        }),
      ),
  );
  const answer: FactoryDecisions["Service"]["answer"] = Effect.fn("FactoryDecisions.answer")(
    (actor, input) =>
      store.transaction(
        Effect.gen(function* () {
          if (actor.kind !== "user") return yield* new FactoryError({ code: "forbidden" });
          yield* control.requireEnabled;
          const card = yield* store.get("cards", input.cardId);
          if (!card) return yield* new FactoryError({ code: "not-found", entityId: input.cardId });
          if (card.revision !== input.revision || card.state !== "open")
            return yield* new FactoryError({ code: "conflict", entityId: card.id });
          const recommended = card.body.options.find((o) => o.recommended)!;
          if (input.yourCall && input.optionId)
            return yield* new FactoryError({ code: "invalid", entityId: card.id });
          const selected = input.yourCall ? recommended.id : input.optionId;
          if (
            (selected && !card.body.options.some((o) => o.id === selected)) ||
            (!selected && !input.note?.trim())
          )
            return yield* new FactoryError({ code: "invalid", entityId: card.id });
          const outcome = input.yourCall
            ? "DEFAULTED"
            : !selected
              ? "RULED"
              : selected === recommended.id
                ? "CHOSE"
                : "CHOSE-against";
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          const saved = yield* store.put("cards", {
            ...card,
            state: "answered",
            outcome,
            optionId: selected ?? null,
            note: input.note ?? "",
            answeredAt: now,
            updatedAt: now,
          });
          yield* wakes.enqueue({
            id: `answer:${card.id}:${card.revision}`,
            targetId: card.ownerId,
            refKind: "card",
            refId: card.id,
            sourceId: `card:${card.id}:${card.revision}`,
            text: `${outcome}: ${card.body.title}${selected ? `: option ${selected}` : ""}${input.note ? `\nUser note: ${input.note}` : ""}`,
          });
          for (const notification of yield* store.list("notifications")) {
            if (notification.cardId === card.id && notification.state === "pending")
              yield* store.put("notifications", {
                ...notification,
                updatedAt: now,
                state: "cancelled",
              });
          }
          const owner = yield* store.get("agents", card.ownerId);
          if (owner?.needs === card.id)
            yield* store.put("agents", { ...owner, needs: null, updatedAt: now });
          return saved;
        }),
      ),
  );
  const withdraw: FactoryDecisions["Service"]["withdraw"] = Effect.fn("FactoryDecisions.withdraw")(
    (actor, id) =>
      store.transaction(
        Effect.gen(function* () {
          const card = yield* store.get("cards", id);
          if (!card) return yield* new FactoryError({ code: "not-found", entityId: id });
          if (actor.kind === "agent" && (yield* actorAgent(actor)).id !== card.ownerId)
            return yield* new FactoryError({ code: "forbidden" });
          if (card.state === "withdrawn") return card;
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          yield* wakes.revokeSource(`card:${card.id}:${card.revision}`);
          for (const notification of yield* store.list("notifications")) {
            if (notification.cardId === card.id && notification.state === "pending")
              yield* store.put("notifications", {
                ...notification,
                updatedAt: now,
                state: "cancelled",
              });
          }
          const owner = yield* store.get("agents", card.ownerId);
          if (owner?.needs === card.id)
            yield* store.put("agents", { ...owner, needs: null, updatedAt: now });
          return yield* store.put("cards", { ...card, state: "withdrawn", updatedAt: now });
        }),
      ),
  );
  const payload: FactoryDecisions["Service"]["payload"] = Effect.fn("FactoryDecisions.payload")(
    (actor, envelope) =>
      store.transaction(
        Effect.gen(function* () {
          const owner = yield* actorAgent(actor);
          if (envelope.kind !== envelope.request.type)
            return yield* new FactoryError({ code: "invalid" });
          const bytes = new TextEncoder().encode(canonicalAction(envelope));
          const hash = Array.from(yield* digests.digest(Digest.sha256, bytes))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const existing = yield* store.get("payloads", hash);
          if (existing && existing.ownerId !== owner.id)
            return yield* new FactoryError({ code: "conflict", entityId: hash });
          if (!existing) {
            const now = DateTime.toEpochMillis(yield* DateTime.now);
            yield* store.put("payloads", {
              id: hash,
              sha256: hash,
              ownerId: owner.id,
              envelope,
              version: 0,
              createdAt: now,
              updatedAt: now,
            });
          }
          return hash;
        }),
      ),
  );
  return FactoryDecisions.of({ file, answer, withdraw, payload });
});
export const layer = Layer.effect(FactoryDecisions, make);
