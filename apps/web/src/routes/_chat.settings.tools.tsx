import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old Fold settings URL; its content lives at /settings/integrations again. */
export const Route = createFileRoute("/_chat/settings/tools")({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/settings/integrations",
      search: {},
      hash: location.hash,
      replace: true,
    });
  },
});
