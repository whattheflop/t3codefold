import { WS_METHODS, type OrchestrationClientOrigin } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { RpcMessage, RpcServer } from "effect/rpc";

type RequestId = string | number;

const LEGACY_MOBILE_APP_VERSION = "1.4.5";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const legacyCompactIdleThreads = (value: unknown): unknown => {
  switch (value) {
    case "beforeCacheExpires":
      return true;
    case "onReturn":
    case "off":
      return false;
    default:
      return value;
  }
};

const withLegacySettings = (value: unknown): unknown => {
  if (!isRecord(value) || !("compactIdleThreads" in value)) return value;
  return {
    ...value,
    compactIdleThreads: legacyCompactIdleThreads(value.compactIdleThreads),
  };
};

const withLegacyServerConfig = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.settings)) return value;
  return { ...value, settings: withLegacySettings(value.settings) };
};

const withLegacyServerConfigEvent = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  if (value.type === "snapshot") {
    return { ...value, config: withLegacyServerConfig(value.config) };
  }
  if (value.type === "settingsUpdated" && isRecord(value.payload)) {
    return {
      ...value,
      payload: {
        ...value.payload,
        settings: withLegacySettings(value.payload.settings),
      },
    };
  }
  return value;
};

/** The 1.4.5 mobile schema still expects the former boolean setting on the wire. */
export function needsLegacyServerConfig(origin: OrchestrationClientOrigin): boolean {
  return origin.surface === "mobile" && origin.appVersion === LEGACY_MOBILE_APP_VERSION;
}

export function withLegacyServerConfigProtocol(
  protocol: RpcServer.Protocol["Service"],
): RpcServer.Protocol["Service"] {
  const configRequests = new Map<number, Map<RequestId, "stream" | "unary">>();

  const removeRequest = (clientId: number, requestId: RequestId) => {
    const requests = configRequests.get(clientId);
    requests?.delete(requestId);
    if (requests?.size === 0) configRequests.delete(clientId);
  };

  const track = (clientId: number, message: RpcMessage.FromClientEncoded) => {
    if (message._tag === "Request") {
      const kind =
        message.tag === WS_METHODS.subscribeServerConfig
          ? "stream"
          : message.tag === WS_METHODS.serverGetConfig
            ? "unary"
            : undefined;
      if (kind !== undefined) {
        const requests = configRequests.get(clientId) ?? new Map();
        requests.set(message.id, kind);
        configRequests.set(clientId, requests);
      }
    } else if (message._tag === "Interrupt") {
      removeRequest(clientId, message.requestId);
    } else if (message._tag === "Eof") {
      configRequests.delete(clientId);
    }
  };

  return {
    ...protocol,
    run: (write) =>
      protocol.run((clientId, message) =>
        Effect.sync(() => track(clientId, message)).pipe(Effect.andThen(write(clientId, message))),
      ),
    send: Effect.fn("send")(function (clientId, response, transferables) {
      const requests = configRequests.get(clientId);
      const kind = "requestId" in response ? requests?.get(response.requestId) : undefined;
      if (kind === undefined) return protocol.send(clientId, response, transferables);

      let compatibleResponse = response;
      if (response._tag === "Chunk" && kind === "stream") {
        const [first, ...rest] = response.values;
        compatibleResponse = {
          ...response,
          values: [withLegacyServerConfigEvent(first), ...rest.map(withLegacyServerConfigEvent)],
        };
      } else if (response._tag === "Exit" && kind === "unary" && response.exit._tag === "Success") {
        compatibleResponse = {
          ...response,
          exit: { ...response.exit, value: withLegacyServerConfig(response.exit.value) },
        };
      }

      if (response._tag === "Exit") {
        removeRequest(clientId, response.requestId);
      }
      return protocol.send(clientId, compatibleResponse, transferables);
    }),
    end: (clientId) => {
      configRequests.delete(clientId);
      return protocol.end(clientId);
    },
  };
}

export function serverConfigProtocolForClient(
  protocol: RpcServer.Protocol["Service"],
  origin: OrchestrationClientOrigin,
): RpcServer.Protocol["Service"] {
  return needsLegacyServerConfig(origin) ? withLegacyServerConfigProtocol(protocol) : protocol;
}
