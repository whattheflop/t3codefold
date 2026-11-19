import { T, useGT } from "gt-react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FactoryPage } from "../components/factory/FactoryPage";
import { HerdrFactoryPage } from "../components/factory/HerdrFactoryPage";
import { Button } from "../components/ui/button";

function FactoryWorkspace() {
  const gt = useGT();
  const [backend, setBackend] = useState<"herdr" | "t3">("herdr");
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <nav className="flex shrink-0 gap-1 border-b px-3 py-2" aria-label={gt("Factory backend")}>
        <Button
          size="sm"
          variant={backend === "herdr" ? "secondary" : "ghost"}
          onClick={() => setBackend("herdr")}
        >
          <T>Herdr Core</T>
        </Button>
        <Button
          size="sm"
          variant={backend === "t3" ? "secondary" : "ghost"}
          onClick={() => setBackend("t3")}
        >
          <T>T3 sessions</T>
        </Button>
      </nav>
      {backend === "herdr" ? <HerdrFactoryPage /> : <FactoryPage />}
    </div>
  );
}
export const Route = createFileRoute("/_chat/factory")({ component: FactoryWorkspace });
