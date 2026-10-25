import * as Layer from "effect/Layer";

import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import * as FleetBroker from "../FleetBroker.ts";
import * as FleetExecutor from "../FleetExecutor.ts";
import * as FleetRouter from "../FleetRouter.ts";
import * as OrchestratorMcpService from "../OrchestratorMcpService.ts";

/**
 * Fleet routing for server.ts's routes. The MCP toolkits and the WebSocket fleet
 * handlers share one broker, so a request routed by an MCP tool reaches the client
 * connection that leased it.
 */
export const layerFleet = FleetExecutor.layer.pipe(
  Layer.provide(OrchestratorMcpService.layer),
  Layer.provide(ProviderAdapterRegistry.layerFromProviderInstanceRegistry),
  Layer.provideMerge(FleetRouter.layer),
  Layer.provideMerge(FleetBroker.layer),
);
