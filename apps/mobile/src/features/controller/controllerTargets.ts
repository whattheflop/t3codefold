export function createControllerTargets() {
  const targets = new Map<
    string,
    {
      activate: () => void;
      dictate?: () => boolean | void;
      adjust?: (direction: -1 | 1) => void;
      reply?: boolean;
      scope: string;
    }
  >();
  const listeners = new Set<(scope: string) => void>();
  const changed = (scope: string) => listeners.forEach((listener) => listener(scope));
  return {
    subscribe(listener: (scope: string) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    has(id: string, scope: string) {
      return targets.get(id)?.scope === scope;
    },
    register(
      id: string,
      target: {
        activate: () => void;
        dictate?: () => boolean | void;
        adjust?: (direction: -1 | 1) => void;
        reply?: boolean;
      },
      scope = "",
    ) {
      const registered = { ...target, scope };
      targets.set(id, registered);
      changed(scope);
      return () => {
        if (targets.get(id) === registered) {
          targets.delete(id);
          changed(scope);
        }
      };
    },
    dispatch(id: string, action: "activate" | "dictate" | "decrement" | "increment", scope = "") {
      const target = targets.get(id);
      if (!target || target.scope !== scope) return false;
      if (action === "activate") {
        target.activate();
        return true;
      }
      if (action === "decrement" || action === "increment") {
        if (!target.adjust) return false;
        target.adjust(action === "decrement" ? -1 : 1);
        return true;
      }
      return target.dictate !== undefined && target.dictate() !== false;
    },
  };
}
export const controllerTargets = createControllerTargets();
