import * as Layer from "effect/Layer";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import type * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import type * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import { orchestrationSeamsLayer } from "./OrchestrationSeams.ts";
import * as PeerService from "./PeerService.ts";
import * as SourceService from "./SourceService.ts";
import * as VerificationRunner from "./VerificationRunner.ts";
import * as VerificationRuntime from "./VerificationRuntime.ts";
import * as WorkRuntime from "./WorkRuntime.ts";
import * as WorkStore from "./WorkStore.ts";

const layerPeerServiceProvided = PeerService.layer.pipe(
  Layer.provide(Layer.mergeAll(WorkStore.layer, ServerSecretStore.layer)),
);
const layerSourceServiceProvided = SourceService.layer.pipe(
  Layer.provide(Layer.mergeAll(WorkStore.layer, ServerSecretStore.layer)),
);
const layerVerificationRuntimeProvided = VerificationRuntime.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      WorkStore.layer,
      ProjectStore.layer,
      VerificationRunner.layer.pipe(Layer.provide(ProcessRunner.layer)),
    ),
  ),
);

/**
 * Pitboss services and background runtimes that run alongside orchestration, for
 * runtimeLayer's production graph. The work runtime launches and manages threads
 * through the same provided layers orchestration uses.
 */
export const layerPitboss = <E1, R1, E2, R2>(orchestration: {
  readonly threadLaunch: Layer.Layer<ThreadLaunchService.ThreadLaunchService, E1, R1>;
  readonly threadManagement: Layer.Layer<ThreadManagementService.ThreadManagementService, E2, R2>;
}) =>
  Layer.mergeAll(
    WorkStore.layer,
    layerPeerServiceProvided,
    layerSourceServiceProvided,
    layerVerificationRuntimeProvided,
    WorkRuntime.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          WorkStore.layer,
          layerPeerServiceProvided,
          orchestration.threadLaunch,
          orchestration.threadManagement,
        ),
      ),
    ),
  );

/**
 * The orchestrator and turn-start layers read these references when they are built, so the
 * pitboss retention guard and managed-work preamble only apply in the production graph.
 */
export const layerPitbossOrchestrationSeams = orchestrationSeamsLayer.pipe(
  Layer.provide(WorkStore.layer),
);
