# V0.7.7 — View Binding States

RecordingJunction now accepts optional `bindingKeys: {yaw,pitch,bound}[]`.
Legacy absence remains always enabled (subject to source coverage).
The state field uses the existing canonical Delaunay/collinear evaluator; outside
its hull it uses closest-boundary state interpolation. A value strictly above
0.5 enables the full constraint; 0.5 and below disables it. No partial binding.

In the Junction inspector, Unbind at This View snapshots the follower's current
POSITION-derived endpoint and adjacent handle into its raw key, then records an
unbound state in the same history transaction. Other endpoint raw coordinates
are retained to avoid double-applying unrelated bindings. Smooth transitions
are not baked: they disappear while their style keys remain saved.
On first state edit, legacy relationships receive bound support at the two
curves' existing key views before the edited view is overridden. Thereafter
binding state keys are independent of shape keys.

Bind at This View creates exact raw keys for both involved curves and records
a bound state. It uses normal binding to close the endpoint; rebind may move it.
Endpoint shared editing traverses only enabled relations, even at frozen views.
Inactive relations no longer intercept direct handle or Merge writeback.

A state switch is discrete and can cause a positional jump at the state-region
boundary. Source coverage rules remain: enabled state does not render a frozen
curve in Final Preview. Each inspector controls the explicitly listed relation;
other relations and Smooth style fields are retained.
