# Partial fitted families: membership and source deletion

This change preserves the existing cubic fitter, authored layer domains, stable
canonical identities, and source-deletion ownership rules. It adds no saved
geometry, Snapshot type, interpolation law, or persistent schema field.

## Local membership

A fitted family may be only partly displayed in a Snapshot or layer. Its live
siblings remain input dependencies of that field. `prepareLayerCageDependencies`
resolves only the needed siblings at the existing explicit parent-layer address;
`memberSources` continues to identify a moved member's source. Required inputs
pass through the ordinary shape, placement, and domain stages together once.
A runtime namespace distinguishes a dependency in the original layer from the
same canonical curve moved into another layer. It never becomes a library ID.

Every public source/editor/render stage is restricted to the original membership.
Dependency controls do not enter provenance, paint batches, picking, coverage,
Recorder basis membership, or serialized state. The same evaluation's dependency
context can feed a descendant field, including through an intermediate local
placement. This context is invalidated with ordinary live evaluation inputs and
is not an independent Snapshot or source geometry authority.

`createCageSplitProjector` accepts same-stage input pieces separately from the
pieces being rendered. An isolated or reversed native child can use the existing
complete parent fit without rendering its siblings. Complete ARC-trimmed paths
retain their prior trimmed-parent fitting law.

## Actual source deletion

The existing source-deletion transaction removes canonical children and dependent
references. Retired lineage intervals remain on the original 0…1 parameter axis;
remaining pieces are not stretched to fill it. If both outer endpoints survive,
the current outer endpoint controls determine the parent as before. Otherwise,
the longest surviving interval determines the unique parent cubic by inverse
affine de Casteljau restriction (cubic blossom continuation). Ties use stable
parameter order. Independently changed surviving controls still use the existing
explicit live-residual policy. No deleted controls or historical samples are read.

Continuation rejects nonfinite/degenerate ranges, three-stage coefficient
amplification above 2^24, and round-trip control error above 1e-8 times the input
control scale. Source deletion preflights this specific numerical availability
before commit. It does not replace ordinary supported deletion with a blanket
membership rejection, and it does not disable an unrelated curve's entire field.

Authored post-domain correction cubics retain the original fitted-parent
parameter function as runtime correspondence metadata. This permits exact
restriction after deletion, including a correction on a repeatedly split child,
without renormalizing surviving endpoints or saving parent geometry.

Deleting the last curve leaves the layer empty. Explicit source-layer deletion
still cascades through all layer references. Deleted sources never supply red
coverage fallbacks or onion basis curves. Undo/Redo restores the one transaction.

## Material and verification boundary

A local exclusion in an inserted real view suspends its incomplete split material
measurement exactly as an incomplete path measurement already does. The authored
Recorder field remains available for restoration. Other geometry and material
relationships continue to evaluate.

Focused tests cover independently edited hidden siblings; source updates after
exclusion; both deletion directions; repeated splits and nested authored
corrections; parent/child cages; inherited-only intermediate placement; moved
members with an explicit detached endpoint; complete public-stage filtering;
source-layer cascade; strict JSON; one Undo/Redo; absent red coverage ghosts; and
precise numerical rejection. The existing authored-interval-after-insert split
boundary is unchanged. Reflection source-split adaptation remains separate
integration work.

## Child-authored topology over inherited fields

Ordinary Drawing and real-Snapshot Pen targets retain new canonical IDs and local
membership. New child inputs use the retained cage's rest frame and today's live
parent material program; an explicit sparse local output stage records the
requested final Drawing controls. The parent's source and program are unchanged.
Future parent members inherit the field with no child-authored per-member delta.

True endpoint binding aliases canonical material nodes before the same program
replay, then captures the requested shared-node output once. Fitted output handles
are never inverse-fitted into source controls. The same dependency preparation
supplies hidden live split siblings before program replay and restricts them out
of the public result. Its adapted context survives identity-preserving assembly,
so later child stages use the topology-adapted inputs instead of the original
parent graph. An inherited-only hidden dependency does not acquire participation
in the child's visible post-control relation solve.

Combined tests cover Pen and true binding after exclusion of an independently
edited split sibling, strict JSON, and further live source edits. Pen does not
create correction entries for the unaffected inherited survivor.
