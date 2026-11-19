import { expect, it } from "@effect/vitest";
import { controllerRoutes } from "./controller-inventory.ts";

it("includes named routes across settings spreads and omits only development routes from production coverage", () => {
  const routes = controllerRoutes(
    `const settings = { 'Voice': createNativeStackScreen({screen: Voice}) }; const stack = { screens: { ...settings, ...(__DEV__ ? { Catalog: createNativeStackScreen({}) } : {}), Thread: createNativeStackScreen({linking: {path: 'threads/:id'}}) } };`,
  );
  expect(routes).toEqual([
    { name: "Voice", developmentOnly: false },
    { name: "Catalog", developmentOnly: true },
    { name: "Thread", developmentOnly: false },
  ]);
  expect(() => controllerRoutes("const empty = {};")).toThrow("coverage denominator");
  expect(() =>
    controllerRoutes("const routes = {[dynamic]: createNativeStackScreen({})};"),
  ).toThrow("Computed route key");
});
