import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old Fold settings URL; its content lives at /settings/source-control again. */
export const Route = createFileRoute("/_chat/settings/git")({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: "/settings/source-control",
      search: {},
      hash: location.hash,
      replace: true,
    });
  },
});
