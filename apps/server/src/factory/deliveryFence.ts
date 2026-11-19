import { factoryIsEnabled } from "./FactoryControl.ts";
import {
  FactoryDelivery,
  FactoryError,
  FactorySource,
  FactoryWake,
  type FactoryDeliveryMetadata,
  type CommandId,
  type MessageId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const decodeDelivery = Schema.decodeEffect(Schema.fromJsonString(FactoryDelivery));
const decodeSource = Schema.decodeEffect(Schema.fromJsonString(FactorySource));
const decodeWake = Schema.decodeEffect(Schema.fromJsonString(FactoryWake));
const encodeWake = Schema.encodeEffect(Schema.fromJsonString(FactoryWake));
const encodeDelivery = Schema.encodeEffect(Schema.fromJsonString(FactoryDelivery));

export interface FactoryDeliveryAcceptance extends FactoryDeliveryMetadata {
  readonly messageId: MessageId;
  readonly text: string;
}

/** Must run inside EventSink's receipt/events transaction, never on a separate connection. */
export const acceptFactoryDelivery = Effect.fn("Factory.acceptDelivery")(function* (input: {
  readonly threadId: ThreadId;
  readonly commandId: CommandId;
  readonly delivery: FactoryDeliveryAcceptance;
}) {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* factoryIsEnabled)) return yield* new FactoryError({ code: "disabled" });
  const fail = () => new FactoryError({ code: "conflict", entityId: input.delivery.deliveryId });
  const rows = yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM factory_wake_deliveries WHERE id = ${input.delivery.deliveryId}`;
  if (!rows[0]) return yield* fail();
  const claim = yield* decodeDelivery(rows[0].payload_json);
  if (
    claim.state !== "claimed" ||
    claim.threadId !== input.threadId ||
    claim.commandId !== input.commandId ||
    claim.messageId !== input.delivery.messageId ||
    claim.text !== input.delivery.text ||
    claim.routingEpoch !== input.delivery.routingEpoch ||
    claim.sourceId !== input.delivery.sourceId ||
    claim.sourceEpoch !== input.delivery.sourceEpoch
  )
    return yield* fail();
  const sources = yield* sql<{
    payload_json: string;
  }>`SELECT payload_json FROM factory_delivery_sources WHERE id = ${claim.sourceId}`;
  if (!sources[0]) return yield* fail();
  const source = yield* decodeSource(sources[0].payload_json);
  if (source.state === "revoked" || source.epoch !== claim.sourceEpoch) return yield* fail();
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  for (const id of claim.wakeIds) {
    const wakes = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM factory_wakes WHERE id = ${id}`;
    if (!wakes[0]) return yield* fail();
    const wake = yield* decodeWake(wakes[0].payload_json);
    if (
      wake.sourceId !== claim.sourceId ||
      wake.sourceEpoch !== claim.sourceEpoch ||
      wake.routingEpoch !== claim.routingEpoch ||
      wake.targetId !== claim.targetId ||
      wake.deliveryId !== claim.id ||
      !["queued", "held", "delivered"].includes(wake.state)
    )
      return yield* fail();
    const updated = {
      ...wake,
      version: wake.version + 1,
      state: "delivered" as const,
      attempts: wake.attempts + 1,
      holdReason: null,
      updatedAt: now,
      nextAttemptAt: now + 30 * 60_000,
    };
    const json = yield* encodeWake(updated);
    yield* sql`UPDATE factory_wakes SET version = ${updated.version}, payload_json = ${json} WHERE id = ${id}`;
    yield* sql`INSERT INTO factory_events (kind, entity_id, payload_json, occurred_at) VALUES ('wakes', ${id}, ${json}, ${now})`;
  }
  const accepted = {
    ...claim,
    version: claim.version + 1,
    state: "accepted" as const,
    updatedAt: now,
  };
  const json = yield* encodeDelivery(accepted);
  yield* sql`UPDATE factory_wake_deliveries SET version = ${accepted.version}, payload_json = ${json} WHERE id = ${claim.id}`;
  yield* sql`INSERT INTO factory_events (kind, entity_id, payload_json, occurred_at) VALUES ('deliveries', ${claim.id}, ${json}, ${now})`;
});
