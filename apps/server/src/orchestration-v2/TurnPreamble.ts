import type { OrchestrationV2RunAttempt, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * Supplies text that leads a provider turn, such as managed-work rules for this thread. It is
 * keyed by attempt so a retried attempt reuses the text it started with. The default adds none.
 * It never fails: a provider that cannot read its preamble returns null so the turn still starts.
 */
interface TurnPreambleShape {
  readonly forAttempt: (
    threadId: ThreadId,
    attemptId: OrchestrationV2RunAttempt["id"],
  ) => Effect.Effect<string | null>;
}

export class TurnPreamble extends Context.Reference<TurnPreambleShape>(
  "t3/orchestration-v2/ProviderTurnStartService/TurnPreamble",
  {
    defaultValue: () => ({ forAttempt: () => Effect.succeed(null) }),
  },
) {}

/**
 * The provider text for a turn, led by the attempt's preamble. Slash commands such as /compact
 * must reach the provider verbatim, so they skip it. The wrapper keeps a preamble from being
 * mistaken for text the user wrote.
 */
export const withTurnPreamble = (
  preamble: TurnPreambleShape,
  input: {
    readonly threadId: ThreadId;
    readonly attemptId: OrchestrationV2RunAttempt["id"];
    readonly message: { readonly text: string; readonly attachments: ReadonlyArray<unknown> };
    readonly providerText: string;
  },
) =>
  input.message.attachments.length === 0 && input.message.text.trimStart().startsWith("/")
    ? Effect.succeed(input.providerText)
    : preamble
        .forAttempt(input.threadId, input.attemptId)
        .pipe(
          Effect.map((text) =>
            text === null
              ? input.providerText
              : `${text}\n\n<user_request>\n${input.providerText}\n</user_request>`,
          ),
        );
