import { useAtomValue } from "@effect/atom-react";
import { FOLD_REPOSITORY } from "@t3tools/shared/foldRelease";
import * as Effect from "effect/Effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

/**
 * Whether Fold's `fold-server-v<version>` release exists. Fold servers update
 * from these GitHub releases, never upstream's npm `t3`, so this replaces
 * upstream's npm check for "update everything". A 404 is false; network and
 * API errors stay unknown. Both re-check every few minutes.
 */
export const foldServerReleasePublishedAtom = Atom.family((version: string) =>
  Atom.make(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(
        `https://api.github.com/repos/${FOLD_REPOSITORY}/releases/tags/fold-server-v${encodeURIComponent(version)}`,
      );
      if (response.status === 404) return false;
      yield* HttpClientResponse.filterStatusOk(response);
      return true;
    }).pipe(
      // Public release checks do not need tracing headers or their CORS preflight.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(
    Atom.withRefresh("5 minutes"),
    Atom.keepAlive,
    Atom.withLabel(`fold-server-release-published:${version}`),
  ),
);

const NO_VERSION_ATOM = Atom.make(AsyncResult.success(false)).pipe(
  Atom.withLabel("fold-server-release-published:none"),
);

/** True only once Fold's release for `version` is confirmed. */
export function useFoldServerReleasePublished(version: string | null): boolean {
  const result = useAtomValue(version ? foldServerReleasePublishedAtom(version) : NO_VERSION_ATOM);
  return AsyncResult.getOrElse(result, () => false);
}
