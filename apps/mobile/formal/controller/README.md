# Controller navigation proofs

This is a Lean 4 specification of the navigation contract, not a proof of the React Native or Kotlin implementation. Lean checks arbitrary natural-number scope/surface identities and finite stacks; it does not merely enumerate the example traces.

The model separates navigation mode, recording ownership, suspension, and reply availability. `step` defines the transitions. Its kernel-checked theorems cover reply access when available, deferred focus when it becomes available, restoration after nested overlays, rejection of obsolete epochs/revisions, effects belonging to the active input owner, and recovery without activation. Back strictly decreases a natural-number rank until root navigation: at most `2 + 3 × overlay depth` delivered Back transitions. Root navigation can be reading or generic navigation; reaching it does not mean leaving the application.

The liveness assumptions matter: the app has resumed, input reaches it, the stack is finite, and no external event keeps adding layers. Deferred reply completion needs a sufficiently fresh availability event. The proof cannot force an unavailable microphone or editor to appear, or make Android deliver a controller event.

## Run

Install [elan](https://lean-lang.org/install/manual/), then from this directory:

```sh
./check.sh
```

The pinned toolchain supplies Lean and Lake; no Mathlib or other package downloads are needed after installing it. The check rebuilds the model, audits every theorem's axiom dependencies, and compares the executable model's traces with `Traces.json`. Only Lean's standard `propext` and `Quot.sound` dependencies are allowed; admitted proofs and custom axioms fail the check.

From the repository root, compare the exported traces with the actual navigation session:

```sh
node_modules/.bin/vp test run apps/mobile/src/features/controller/controllerFormal.test.ts
```

When intentionally changing the specification, regenerate the trace fixture with `.lake/build/bin/controllerModel > Traces.json` after `lake build`, format the JSON, then run both checks. A generated fixture without the production conformance check establishes no implementation evidence.

## Verification boundary

`Main.lean` exports sixteen traces on two text surfaces. The production test compares modes, active scopes, text surfaces, reply selection and action activation counts after each event. It executes the production TypeScript session, with native effects and voice callbacks represented by test adapters. This is finite conformance evidence, **not a machine-checked refinement proof from TypeScript to Lean**.

The model assumes a declared active owner; it does not prove discovery of that owner among multiple mounted composers or Android views. The abstraction omits route replacement, workspace pane geometry, ordered widgets, virtualized targets, native editor acknowledgement, OS focus, missed releases, microphone permissions, audio processing, provider/server behavior, and the queued intent to begin dictation when an editor is missing. Its deferred intent represents focus only. Scene versions are abstract epoch/revision stamps; the TypeScript adapter uses its own request and scene counters. Those counters are not formally translated here.

The model's Back function cannot prove that external navigation or voice callbacks finish correctly. Runtime acceptance and the [navigation contract](../../../../docs/internals/controller-navigation.md) remain required. The native-probe graph reports untested route/layouts independently. These proof checks are explicit commands; the existing changed-file check runs the TypeScript conformance test but does not install or invoke Lean.
