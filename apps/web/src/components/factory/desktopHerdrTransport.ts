import type { DesktopHerdrRequest } from "@t3tools/contracts";
import type { CoreTransport } from "@t3tools/client-runtime/herdr/client";
import type { HerdrDestination } from "@t3tools/client-runtime/herdr/destinations";

export function desktopHerdrTransport(destination: HerdrDestination): CoreTransport {
  let expectedCoreId = destination.coreId;
  return async (method, params) => {
    const request = window.desktopBridge?.herdrRequest;
    if (!request)
      throw new Error("Native Core connections require a desktop build with Herdr support.");
    const input: DesktopHerdrRequest = {
      socketPath: destination.socketPath,
      ...(destination.sshHost ? { sshHost: destination.sshHost } : {}),
      ...(expectedCoreId ? { expectedCoreId } : {}),
      method,
      params,
    };
    const result = await request(input);
    if (
      method === "hello" &&
      result &&
      typeof result === "object" &&
      "core" in result &&
      result.core &&
      typeof result.core === "object" &&
      "id" in result.core &&
      typeof result.core.id === "string"
    )
      expectedCoreId ??= result.core.id;
    return result;
  };
}
