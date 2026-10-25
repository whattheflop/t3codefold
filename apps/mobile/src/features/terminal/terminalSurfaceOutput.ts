import {
  readTerminalOutputUpdate,
  terminalOutputText,
  type TerminalOutputCursor,
  type TerminalOutputState,
} from "@t3tools/client-runtime/state/terminal";
import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { NativeSyntheticEvent } from "react-native";

/**
 * The `output` prop of the native terminal view: `data` continues reset stream
 * `resetId` from UTF-16 offset `start`. A `resetId` the view has not applied yet
 * (always with `start` 0) clears the terminal and replays `data` as history.
 *
 * Each write repeats everything after the offset the view last acknowledged.
 * Fabric mounts only the latest committed props, so a write that assumed the
 * previous one arrived could leave a gap; resending from the acknowledged
 * offset makes a skipped write harmless and a repeated write a no-op.
 */
export interface TerminalSurfaceOutput {
  readonly resetId: number;
  readonly start: number;
  readonly data: string;
}

/**
 * Emitted by the native view after applying output: it holds stream `resetId`
 * up to UTF-16 offset `end`. `resetId` 0 means it holds nothing, for example
 * after recreating its terminal.
 */
export interface TerminalSurfaceOutputAck {
  readonly resetId: number;
  readonly end: number;
}

/** The reset stream a surface is feeding. `base` is the output cursor at stream offset 0. */
export interface TerminalSurfaceStream {
  readonly resetId: number;
  readonly replayKey: string;
  readonly base: TerminalOutputCursor;
}

/**
 * Derives the next native write from the session output. Output is appended
 * while the stream can continue; a cleared or restarted session, history
 * trimmed past what the view acknowledged, or a new `replayKey` (terminal or
 * font change) starts a new stream that replays the retained buffer.
 */
export function nextTerminalSurfaceOutput(input: {
  readonly output: TerminalOutputState;
  readonly replayKey: string;
  readonly stream: TerminalSurfaceStream | null;
  readonly ack: TerminalSurfaceOutputAck | null;
}): { readonly stream: TerminalSurfaceStream; readonly write: TerminalSurfaceOutput } {
  const { output, replayKey, stream, ack } = input;
  if (stream !== null && stream.replayKey === replayKey) {
    const start = ack !== null && ack.resetId === stream.resetId ? ack.end : 0;
    const update = readTerminalOutputUpdate(output, {
      ...stream.base,
      offset: stream.base.offset + start,
    });
    if (update.type !== "reset") {
      return {
        stream,
        write: {
          resetId: stream.resetId,
          start,
          data: update.type === "append" ? update.data : "",
        },
      };
    }
  }

  const resetId = (stream?.resetId ?? 0) + 1;
  return {
    stream: {
      resetId,
      replayKey,
      base: {
        generation: output.generation,
        resetVersion: output.resetVersion,
        offset: output.chunks[0]?.startOffset ?? output.nextOffset,
      },
    },
    write: { resetId, start: 0, data: terminalOutputText(output) },
  };
}

/** Whether the view cannot continue `write` from what it acknowledged and needs a new one. */
export function terminalSurfaceNeedsResend(
  write: TerminalSurfaceOutput,
  ack: TerminalSurfaceOutputAck,
): boolean {
  return write.start > (ack.resetId === write.resetId ? ack.end : 0);
}

export function isSameTerminalSurfaceOutput(
  left: TerminalSurfaceOutput,
  right: TerminalSurfaceOutput,
): boolean {
  return left.resetId === right.resetId && left.start === right.start && left.data === right.data;
}

/**
 * Streams session output to the native view as resets and appends instead of
 * the whole buffer, so retained-history trimming never forces a replay.
 */
export function useNativeTerminalOutput(output: TerminalOutputState, replayKey: string) {
  const streamRef = useRef<TerminalSurfaceStream | null>(null);
  const ackRef = useRef<TerminalSurfaceOutputAck | null>(null);
  const writeRef = useRef<TerminalSurfaceOutput | null>(null);
  const [resendRequest, requestResend] = useReducer((count: number) => count + 1, 0);
  // Refs hold only committed state, so a discarded render recomputes the same write.
  const next = useMemo(
    () =>
      nextTerminalSurfaceOutput({
        output,
        replayKey,
        stream: streamRef.current,
        ack: ackRef.current,
      }),
    // resendRequest re-derives the write from a newer acknowledgement.
    [output, replayKey, resendRequest],
  );
  const previous = writeRef.current;
  const write =
    previous !== null && isSameTerminalSurfaceOutput(previous, next.write) ? previous : next.write;

  useLayoutEffect(() => {
    streamRef.current = next.stream;
    writeRef.current = write;
  }, [next, write]);

  const handleOutputApplied = useCallback(
    (event: NativeSyntheticEvent<TerminalSurfaceOutputAck>) => {
      const ack = { resetId: event.nativeEvent.resetId, end: event.nativeEvent.end };
      ackRef.current = ack;
      const sent = writeRef.current;
      if (sent !== null && terminalSurfaceNeedsResend(sent, ack)) {
        requestResend();
      }
    },
    [],
  );

  return { write, handleOutputApplied };
}
