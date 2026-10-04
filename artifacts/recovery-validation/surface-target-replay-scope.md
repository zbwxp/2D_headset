# Reconstructed native surface inverse scope

Date: 2026-10-04 UTC.

This change reconstructs the lost b6ecc9a331702df858192e8737156556667eadd7 implementation from the retained task patch history on the independently verified v88 development recovery tree. It is a new commit, not restoration of the lost Git object. The reconstruction base was d77489449eb47066352717e65cf05663bdd1cb72; shared trust pooling and the zero-array identity check were reconstructed separately in b6c64f7 before the two fallback callsites were added.

The original direct-plan path is unchanged. The added read/replay scope requires the genuine controlled target proof and follows native drawing revision ancestry to that plan's source controls. It includes all native dirty curves, the original plan closure, linked node authorities, and members of touched SMOOTH components. Changed metadata references, missing provenance, hidden controls, domain plans and deferred projectors retain the full validator. Expressions and mirror samplers retain the full solver path. This does not create or register an authoring plan from dirty IDs. Protected-angle and complete coupled-workspace validation remain intact.

## Source Git blob hashes

- src/domain/recordingSnapshot/surfaceTargets.ts: bf0c3e2628c1d6826f6428961eefdfe10bc39b9b
- src/domain/recordingSnapshot/surfaceTargetReplayScope.ts: 42173fc1f7882be305756e366cc3c522e539cf8b
- src/domain/recordingSnapshot/surfaceBasisFallback.ts: aaded10add2971755450ab48f017c08ed5d15d14
- src/tests/recordingSnapshot/surface-target-replay-scope.test.ts: 7d87c7a1e5451eddf46186cf44318d865251fba2

The surfaceTargets and surfaceBasisFallback hashes match the corresponding recorded pre-loss diff hashes. The helper and test file were recreated from the complete retained patch text.

## Fresh verification on reconstructed source

- Four focused Vitest files passed: surface-target-replay-scope, surface-targets, minchange-inverse-workflow and prepared-recording-context. All 67 tests passed, with the local golden fixture enabled and no skips.
- Seven focused scope tests cover constant work at 0/100/1000 unrelated curves, cold solver parity, linked/SMOOTH authority expansion, unproved targets including nonfinite data outside the declared selection, fabricated plans, interrupted ancestry, metadata/ARC changes, mirror/expression uncertainty, deferred projectors, domain plans and hidden dirty controls.
- A separate temporary local gate passed all four planned golden targets. It checked canonical authoring parity, final target error, cold drawing/paint/diagnostic parity, exact zero-basis equality and unchanged input hash. The gate was removed afterward and no private fixture data or harness is included in this commit.
- npx tsc -b --pretty false completed successfully on the final reconstructed source and tests.
- git diff --check passed.

The constant-work test records 4 node solves, 4 handle solves, 4 node replay checks, 4 handle replay checks, and 0 topology comparisons for each unrelated-curve count. The linked case performs 3 authority-node solves while checking all 4 linked node outputs. Numerical sampler work stays constant; copied array slots still grow with drawing size.

The four local golden targets reproduced the earlier recorded counters exactly. The two node targets used one native ancestry step, 18 metadata reference comparisons, and a replay scope of 5 curves/6 nodes. The second group target used one ancestry step and a scope of 9 curves/9 nodes. The first group target retained the preexisting direct-plan path. All four reported zero inverse topology comparisons and maximum replay error 1.1102230246251565e-16. No elapsed-time or production-performance claim is made; a fresh matched benchmark remains separate.
