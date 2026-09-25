# V0.7.5 — Shared Junction Editing

Supersedes V0.7.4's follower endpoint drag prohibition. Dragging either member of an active POSITION junction edits the same shared point. The active endpoint component is found without joining unrelated endpoints of a curve. The drag updates the root driver and authors ordinary current-view raw keys for every curve in that component in one transaction. Followers keep their raw field semantics; derived translation preserves each endpoint-relative handle vector.

The relation direction and serialized schema remain unchanged. Handles still edit independently. Negative yaw inverse-mirrors the target. Exact centerline snapping remains available from either member. Any explicitly locked participating curve prevents the shared edit. Inactive relations outside common coverage do not propagate edits or expand coverage. Merge and Mirror retain their existing command semantics.

Validation: 27 targeted unit tests and production build passed. Tests cover both-side equivalence, per-curve keys, endpoint chains, untouched unrelated curves, negative yaw, preserved handle vectors, locks and inactive coverage.
