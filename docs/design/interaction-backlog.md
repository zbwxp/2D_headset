# Interaction backlog (not point / line / face rules)

Interaction requirements that belong in a later interaction package, not in the core's rules. Each item cites its source.

| # | Requirement | Source |
|---|---|---|
| 1 | Short or zero-length handles need an interactive helper the user can grab (v103 drew a dashed circle). The helper must not change the real handle length to make it easier to pick. | bowen 1791430259; dot 1791430357 |
| 2 | An edit refused because it would change a locked element shows a red cross on the locked line, with a lock icon beside it. A refused smooth-join edit shows a matching hint. | bowen 1791434101 |
| 3 | Each layer gets one switch that shows or hides all its fills at once (a batch over the fill elements). | bowen 1791435415 |
| 4 | While dragging, snapping only shows a preview. The automatic bind happens when the edit completes (mouse released), never mid-drag. | bowen 1791458278 |
| 5 | Paste is offset a little, so a pasted copy never lands on the original's end points in the same layer. | bowen 1791464156 |
| 6 | Delete with only end points selected: red cross with an exclamation mark and the hint "select lines to delete". | bowen 1791465011 |
| 7 | Drag "feel": a later add-on edit layered on dragging (e.g. v103's 40% handle following), still one undo step. | bowen 1791464648 |
| 8 | Scaling: arc-join radius scales only on uniform scaling with both sides of the arc selected; otherwise unchanged. Line width is never scaled by scaling. | bowen 1791464648, 1791471538; dot 1791464744 |
| 9 | Creating a mirror link: choose the tool, pick the source (V, Shift across layers), confirm, pick the targets (V + Shift); topology mismatch reports "topology mismatch, link failed" and changes nothing. | bowen 1791468316 |
| 10 | Layers and first-level elements that hold a mirror link show a small mirror icon in their tag bar; the symmetry axis is shown when a mirror tool is active (or always). | bowen 1791468146, 1791469452 |
| 11 | An operation refused because of a mirror link shows a red cross with a mirror mark where it happens. | bowen 1791467698 |
