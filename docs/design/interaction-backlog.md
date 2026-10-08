# Interaction backlog (not point / line / face rules)

Interaction requirements that belong in a later interaction package, not in the core's rules. Each item cites its source.

| # | Requirement | Source |
|---|---|---|
| 1 | Short or zero-length handles need an interactive helper the user can grab (v103 drew a dashed circle). The helper must not change the real handle length to make it easier to pick. | bowen 1791430259; dot 1791430357 |
| 2 | An edit refused because it would change a locked element shows a red cross on the locked line, with a lock icon beside it. A refused smooth-join edit shows a matching hint. | bowen 1791434101 |
| 3 | Each layer gets one switch that shows or hides all its fills at once (a batch over the fill elements). | bowen 1791435415 |
| 4 | While dragging, snapping only shows a preview. The automatic bind happens when the edit completes (mouse released), never mid-drag. | bowen 1791458278 |
