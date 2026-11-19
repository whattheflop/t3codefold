import { assert, it } from "@effect/vitest";
import { ChildProcessSpawner } from "effect/process";
import type { ProcessRunOutput } from "../processRunner.ts";
import { factoryActionOutcome } from "./FactoryActions.ts";

const output = (stdout: string, overrides: Partial<ProcessRunOutput> = {}): ProcessRunOutput => ({
  stdout,
  stderr: "",
  code: ChildProcessSpawner.ExitCode(0),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
  ...overrides,
});
it("requires an affirmative host merge receipt, even after a zero exit status", () => {
  assert.equal(
    factoryActionOutcome("merge", output('{"merged":false,"message":"Head changed"}')),
    "failed",
  );
  assert.equal(factoryActionOutcome("merge", output('{"merged":true}')), "succeeded");
  assert.equal(factoryActionOutcome("merge", output("not-json")), "unknown");
});
it("keeps timed out, truncated and unsuccessful outward actions uncertain", () => {
  for (const overrides of [
    { timedOut: true },
    { stdoutTruncated: true },
    { stdoutInvalidUtf8: true },
    { code: ChildProcessSpawner.ExitCode(1) },
  ])
    assert.equal(factoryActionOutcome("merge", output('{"merged":true}', overrides)), "unknown");
  assert.equal(factoryActionOutcome("force-push", output("")), "succeeded");
});
