# V0.12.9 · Stroke Layer Groups

Fills whose boundary belongs to one connected stroke in the same layer are now children of that stroke in the sidebar. Folding the stroke folds its curves and fills together. Expanding restores each fill's own color, visibility, lock and diagnostic controls. Selecting a fill on the canvas reveals its parent in the list.

The sidebar hierarchy is derived from existing boundary references. Rendering retains the existing flat paint order; opening or folding the list never changes the artwork. A fill with missing boundary curves or several separate owner strokes remains top-level so it can still be inspected and repaired.

Drag a stroke row to a layer header to move the complete stroke into that layer, including empty or collapsed layers. Drop above/below another row to place it in the target layer's order. Owned fills travel with their stroke and retain their relative paint order. The existing Move to layer control uses the same transfer behavior. Same-layer stroke sorting also carries owned fills.

Transfers preserve IDs, nodes, handles, joins, names and hidden states. Locked members, owned fills or destination layers reject the whole operation. Each completed drop is one Undo transaction; Save/Load uses the existing schema.

Validation: 74 Drawing/i18n unit tests, 24 relevant browser regressions and production build. Coverage includes filled-group folding, real cross-layer drag to collapsed empty layers and ordered targets, hidden members, lock rejection, atomic Undo/Redo and Save/Load.
