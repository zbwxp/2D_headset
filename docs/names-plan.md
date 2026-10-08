# Names: plan and acceptance list

Graph section "Names" (headset-design `eb2748a`; bowen 1791478346, 1791478561, 1791478653, 1791478697):
- **Who is named:** layers, continuous curves and every line carry a name. Points carry none.
- **Uniqueness:** all names are unique across layers, curves and lines, and never empty.
- **Everything else is notes (implementation):** defaults, copy names, names following identity.

## Module

`src/names`: the names of continuous curves (groups) and lines.
- Layer names stay on the layer (`network`). `names` reads them only to check uniqueness.
- Dependencies: `network`, `groups`.
- `document` wires it into the pipeline.

| Function | Does |
|---|---|
| `follow(st, ch)` | After each topology step: a split line's name moves to its first piece (the a end). Run in `applyTopology`. |
| `update(st, n, g)` | At the end of settling:<br>• drop the names of lines and groups that no longer exist;<br>• give every unnamed line "曲线N", in line order;<br>• give every unnamed group "连续曲线N", in group order.<br>N is the next number whose name is free. |
| `rename(st, n, kind, id, name)` | Refuses an empty name. Refuses a name in use, saying which layer, curve or line holds it. |
| `copy(st, n, g, lineMap)` | After a layer copy, every copied line and group is named "<original>副本", or "<original>副本k" with the smallest free k ≥ 2. |
| `check(st, n)` | At commit: every name is unique and non-empty, or the edit is refused. This catches a layer renamed onto a curve name. |
| `copyName(st, n, base)` | The free "<base>副本 / 副本k" name. Also used for the copied layer, replacing `network.uniqueLayerName`'s "name · k". |

Editor: `renameLine(id, name)` and `renameGroup(id, name)`. `renameLayer` additionally checks against curve and line names.
Snapshot: each line and group carries `name`.

## Derived, not asked

- **Identity:** a group split keeps the name on the group that keeps its identity (`groups.reconcile` already decides which). A merge drops the absorbed group's name. Deleting or collapsing a line drops its name.
- **Mirror apply** keeps the target's ids, so it keeps the target's names (dot 1791478538).
- **Locks:** a locked line refuses `renameLine`. Its name is something it owns alone (graph row "Locked element"). A group or layer has no lock of its own (lock is a batch; "Lock does not lock the parent"), so renaming them is allowed.
- **Mirror link:** renames are not paired, because two names may never be equal.
- **Tags:** not in core; the bench shows them if anything (bowen 1791478697).

## Acceptance (tests `test/names.test.ts`)

1. A new line gets "曲线N"; a new continuous curve gets "连续曲线N"; numbers already taken by any name are skipped.
2. Every name in a document is unique, also after: a split; a group split by deleting a middle line; a merge by bind; a copied layer; a mirror apply; undo / redo.
3. A split's first piece keeps the line's name; the second piece gets a default.
4. A group split keeps the name on the identity keeper; the split-off group gets a default. A bind merge keeps the winner's name.
5. Rename refuses an empty name, and a name held by any layer, curve or line, saying who holds it. A renameLayer onto a curve name is refused.
6. A locked line refuses rename. A group whose lines are all locked can still be renamed, and so can its layer.
7. Copy layer: the layer, its curves and its lines are named "<name>副本"; copying again gives "<name>副本2".
8. Mirror apply leaves target names unchanged.
9. A rename is one undo step; a refused rename publishes nothing.
10. Boundary: `names` imports only `network` and `groups`; nothing but `document` imports `names`.
