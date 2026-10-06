#!/usr/bin/env bash
# Pre-commit gate: every check must pass on its FIRST run; nothing is retried, exit codes are not
# hidden behind pipes. Usage: scripts/gate.sh [property-repeats=20]
set -euo pipefail
cd "$(dirname "$0")/.."
repeats="${1:-20}"
log="$(mktemp -d)"
step() { local name="$1"; shift; if "$@" >"$log/$name.log" 2>&1; then echo "PASS $name"; else echo "FAIL $name (log: $log/$name.log)"; tail -30 "$log/$name.log"; exit 1; fi; }
step typecheck npx tsc --noEmit -p .
step unit npx vitest run
step unit-production env NODE_ENV=production npx vitest run
if lsof -nP -iTCP:5179 -sTCP:LISTEN >/dev/null 2>&1; then echo "FAIL e2e: port 5179 already in use (playwright would reuse a foreign server)"; exit 1; fi
step e2e npx playwright test e2e/slice.spec.ts e2e/preview-counts.spec.ts e2e/scene-incremental.spec.ts e2e/scene-pixels.spec.ts
for i in $(seq 1 "$repeats"); do step "properties-$i" env NODE_ENV=production npx vitest run test/properties.test.ts; done
# Known failures are reproduced on purpose (it.fails): listed separately, never counted as fixed.
known=$(grep -oE "it\.fails\('[^']+'" test/known-failures.test.ts | sed "s/it.fails('//; s/'$//")
echo "KNOWN FAILURES (still reproducing, see test/known-failures.test.ts):"
echo "$known" | sed 's/^/  - /'
echo "GATE OK ($repeats property runs)"
