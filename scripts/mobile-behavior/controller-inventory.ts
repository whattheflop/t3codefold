import * as TypeScript from "typescript-legacy";
import type { GraphRoute } from "./controller-graph.ts";

export function controllerRoutes(source: string): GraphRoute[] {
  const file = TypeScript.createSourceFile(
    "Stack.tsx",
    source,
    TypeScript.ScriptTarget.Latest,
    true,
    TypeScript.ScriptKind.TSX,
  );
  const routes = new Map<string, GraphRoute>();
  const visit = (node: TypeScript.Node) => {
    if (
      TypeScript.isPropertyAssignment(node) &&
      TypeScript.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(file) === "createNativeStackScreen"
    ) {
      if (!TypeScript.isIdentifier(node.name) && !TypeScript.isStringLiteral(node.name))
        throw new Error("Computed route key needs an explicit audit inventory adapter.");
      let developmentOnly = false;
      for (let parent: TypeScript.Node | undefined = node.parent; parent; parent = parent.parent) {
        if (
          TypeScript.isConditionalExpression(parent) &&
          parent.condition.getText(file) === "__DEV__"
        )
          developmentOnly = true;
      }
      routes.set(node.name.text, { name: node.name.text, developmentOnly });
    }
    TypeScript.forEachChild(node, visit);
  };
  visit(file);
  if (!routes.size)
    throw new Error("No native stack routes found; refusing an empty coverage denominator.");
  return [...routes.values()];
}
