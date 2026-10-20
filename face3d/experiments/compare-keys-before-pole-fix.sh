#!/bin/sh
# Reproduce the key comparison before / after the pole fix (dot 1792492402): exports face3d/src at 502ddb9 (before the
# pole fix) to face3d/tmp-old, runs face3d/test/compare-keys.test.ts against it and the current src, then removes it.
set -e
cd "$(dirname "$0")/../.."
mkdir -p face3d/tmp-old
for f in bones contour head model outline view; do git show 502ddb9:face3d/src/$f.ts > face3d/tmp-old/$f.ts; done
F3D_COMPARE_OLD=1 npx vitest run --root . --dir face3d face3d/test/compare-keys.test.ts || status=$?
rm -rf face3d/tmp-old
exit ${status:-0}
