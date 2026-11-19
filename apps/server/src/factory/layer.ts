import * as Layer from "effect/Layer";
import * as Factory from "./Factory.ts";
import * as Agents from "./FactoryAgents.ts";
import * as Decisions from "./FactoryDecisions.ts";
import * as Actions from "./FactoryActions.ts";
import * as Triggers from "./FactoryTriggers.ts";
import * as Wakes from "./WakeDelivery.ts";
import * as Queue from "./WakeQueue.ts";
import * as Lanes from "./CommandLanes.ts";
import * as Supervisors from "./LaneSupervisor.ts";
import * as Control from "./FactoryControl.ts";
import * as Store from "./FactoryStore.ts";
import * as Runtime from "./FactoryRuntime.ts";
import * as HostResources from "../resourceTelemetry/HostResources.ts";

const services = Factory.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Agents.layer,
      Decisions.layer,
      Actions.layer,
      Triggers.layer,
      Wakes.layer,
      Lanes.layer,
    ),
  ),
  Layer.provide(Supervisors.layer),
  Layer.provideMerge(Control.layer),
  Layer.provide(HostResources.layer),
  Layer.provideMerge(Queue.layer),
  Layer.provideMerge(Store.layer),
);

export const layer = Runtime.layer.pipe(Layer.provideMerge(services));
