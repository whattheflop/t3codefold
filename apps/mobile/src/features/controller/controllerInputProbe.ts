import { requireNativeModule } from "expo";
import { controllerNavigation } from "./controllerNavigation";

let sequence = 0;
export async function runControllerInput(action: string) {
  if (!__DEV__) throw new Error("Controller input probes require a development build");
  const id = `controller-probe:${++sequence}`;
  const input = controllerNavigation.expectInput(id);
  try {
    const consumed = await requireNativeModule<{
      controllerTestInput(sequence: string, action: string): Promise<boolean>;
    }>("T3NativeControls").controllerTestInput(id, action);
    await input.done;
    await controllerNavigation.settled();
    return { consumed, state: controllerNavigation.snapshot() };
  } finally {
    input.dispose();
  }
}
