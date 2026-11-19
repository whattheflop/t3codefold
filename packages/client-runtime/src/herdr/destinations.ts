import * as Schema from "effect/Schema";
const Destination = Schema.Struct({
  id: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
  socketPath: Schema.NonEmptyString,
  sshHost: Schema.optional(Schema.String),
  coreId: Schema.optional(Schema.String),
  readOnly: Schema.Boolean,
  pins: Schema.Array(Schema.String),
  bindings: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ path: Schema.String, provider: Schema.Literals(["claude", "codex"]) }),
    ),
  ),
});
const decodeDestinations = Schema.decodeUnknownSync(Schema.Array(Destination));
export type HerdrDestination = typeof Destination.Type;
export const HERDR_DESTINATIONS_KEY = "t3.herdr.destinations.v2";
export function validateHerdrTarget(socketPath: string, sshHost?: string) {
  if (
    (!socketPath.startsWith("/") && !socketPath.startsWith("\\\\.\\pipe\\")) ||
    socketPath.includes("\0") ||
    socketPath.includes("\n")
  )
    throw new Error("Enter an absolute Core socket path.");
  if (sshHost && !/^[a-zA-Z0-9][a-zA-Z0-9_.@:-]*$/.test(sshHost))
    throw new Error("Enter an SSH host alias without options.");
}
export function readHerdrDestinations(json: string | null): readonly HerdrDestination[] {
  if (!json) return [];
  try {
    const destinations = decodeDestinations(JSON.parse(json));
    if (new Set(destinations.map((item) => item.id)).size !== destinations.length) return [];
    for (const item of destinations) validateHerdrTarget(item.socketPath, item.sshHost);
    return destinations;
  } catch {
    return [];
  }
}
