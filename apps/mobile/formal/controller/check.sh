#!/usr/bin/env bash
set -euo pipefail
proof_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
proof_tmp=$(mktemp -d "${TMPDIR:-/tmp}/t3-controller-lean.XXXXXX")
trap 'rm -rf -- "$proof_tmp"' EXIT
cd "$proof_dir"
lake env lean Controller.lean > "$proof_tmp/proofs.log" 2>&1 || { cat "$proof_tmp/proofs.log"; exit 1; }
lake build > "$proof_tmp/build.log" 2>&1 || { cat "$proof_tmp/build.log"; exit 1; }
.lake/build/bin/controllerModel > "$proof_tmp/traces.json"
node --input-type=module - "$proof_tmp" <<'JS'
import { readFileSync } from 'node:fs';
import { deepStrictEqual } from 'node:assert';
const directory = process.argv[2];
const source = readFileSync('Controller.lean', 'utf8');
const names = [...source.matchAll(/^theorem (\w+)/gm)].map(match => `Controller.${match[1]}`);
const log = readFileSync(`${directory}/proofs.log`, 'utf8');
const checked = new Set();
for (const match of log.matchAll(/'(Controller\.\w+)' (?:depends on axioms: \[([^\]]*)\]|does not depend on any axioms)/g)) {
  checked.add(match[1]);
  for (const axiom of (match[2] ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    if (!['propext', 'Quot.sound'].includes(axiom)) throw new Error(`Unapproved axiom ${axiom} in ${match[1]}`);
  }
}
for (const name of names) if (!checked.has(name)) throw new Error(`Missing axiom audit: ${name}`);
const actual = JSON.parse(readFileSync(`${directory}/traces.json`, 'utf8'));
deepStrictEqual(actual, JSON.parse(readFileSync('Traces.json', 'utf8')), 'Regenerate Lean traces, then rerun the production conformance test.');
console.log(`${names.length} kernel-checked theorems; no admitted or custom axioms. ${actual.length} trace vectors match the executable model.`);
JS
