import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/herdr")({
  beforeLoad: () => {
    throw redirect({ to: "/factory", replace: true });
  },
});
