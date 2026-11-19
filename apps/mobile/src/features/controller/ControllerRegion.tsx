import { useId, useMemo } from "react";
import type { ControllerRegionKind } from "./controllerNavigation";

export function useControllerRegionId(kind: ControllerRegionKind, identity?: string) {
  const id = useId();
  return `t3-controller-region:${kind}:${identity ?? id}`;
}

export function useControllerSurfaceId(identity: string) {
  return useMemo(() => `t3-controller-surface:${identity}`, [identity]);
}
