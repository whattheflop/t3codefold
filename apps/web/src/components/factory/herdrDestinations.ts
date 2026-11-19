import { useSyncExternalStore } from "react";
import {
  HERDR_DESTINATIONS_KEY,
  readHerdrDestinations,
  type HerdrDestination,
} from "@t3tools/client-runtime/herdr/destinations";

let snapshot: readonly HerdrDestination[] | undefined;
const listeners = new Set<() => void>();
function read() {
  if (!snapshot) {
    try {
      snapshot = readHerdrDestinations(window.localStorage.getItem(HERDR_DESTINATIONS_KEY));
    } catch {
      snapshot = [];
    }
  }
  return snapshot;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const changed = (event: StorageEvent) => {
    if (event.key !== HERDR_DESTINATIONS_KEY) return;
    snapshot = readHerdrDestinations(event.newValue);
    for (const notify of listeners) notify();
  };
  window.addEventListener("storage", changed);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", changed);
  };
}
export function saveHerdrDestination(destination: HerdrDestination) {
  const next = [...read().filter((item) => item.id !== destination.id), destination];
  window.localStorage.setItem(HERDR_DESTINATIONS_KEY, JSON.stringify(next));
  snapshot = next;
  for (const listener of listeners) listener();
}
export function removeHerdrDestination(id: string) {
  const next = read().filter((item) => item.id !== id);
  window.localStorage.setItem(HERDR_DESTINATIONS_KEY, JSON.stringify(next));
  snapshot = next;
  for (const listener of listeners) listener();
}
export function useHerdrDestinations() {
  return useSyncExternalStore(subscribe, read);
}
