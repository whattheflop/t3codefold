import { PitbossPeerEnvelope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { PeerService } from "./PeerService.ts";

const decodeEnvelope = Schema.decodeUnknownEffect(PitbossPeerEnvelope);
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const peers = yield* PeerService;
    return HttpRouter.add(
      "POST",
      "/api/pitboss/peer",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const input = yield* decodeEnvelope(yield* request.json);
        return HttpServerResponse.jsonUnsafe(
          yield* peers.receive(request.headers.authorization ?? "", input),
        );
      }).pipe(
        Effect.orElseSucceed(() =>
          HttpServerResponse.jsonUnsafe(
            { error: "Peer request rejected. Check enrollment, scope, and credential." },
            { status: 403 },
          ),
        ),
      ),
    );
  }),
);
