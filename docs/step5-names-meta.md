# Step 5: name scope and meta (plan before code)

**Status:** checked by dot 1791655027 with three corrections, now in the rules below (rules 1, 3, 5, 6, and the wording of 2). Coding starts with them.

**Decided inputs:**
- Graph row "Names" (bowen 1791649036, 甲): layer (元组件) names are unique in the document; line names are unique within their layer; copying a whole layer keeps the names inside it; a copy inside the same layer still gets "<name>副本".
- Continuous-curve names likewise, within their layer (bowen 1791651929).
- Graph row "元组件": a layer with a **type** and a **name** (bowen 1791645279).
- Graph row "元线条 is identified by": its 元组件 + its name.
- Graph row "Renaming a 元线条 keeps the same line" (bowen 1791648678).
- dot 1791654857 asks to keep three things: a rename never changes identity; copying a 元组件 keeps its inner names; meta keeps no second state.

## Rules

1. **Scope.**
   - Layer names: unique among layers, non-empty.
   - Inside one layer, line names and continuous-curve names share **one** occupancy check, as the old rule did, only narrowed to the layer: a line and a curve in one layer may not share a name (dot 1791655027).
   - Across layers, and between a layer's own name and the names inside it, there is no collision.
2. **Rename keeps identity.**
   - A line is identified internally by its id. A rename changes only the name, so its nine views, its expressions (later) and every reference stay attached.
   - The **lookup key** (layer, name) follows the rename; the object's identity stays its id (dot 1791655027).
3. **Default names.** "曲线N" / "连续曲线N", where N is the **smallest free positive integer within the layer** (dot 1791655027; it was document-wide).
4. **Copy a whole layer (元组件).**
   - The new layer's name is "<name>副本" (then 副本2…; layer names are document-wide).
   - Every line and continuous curve inside keeps its name.
   - Its type is copied.
5. **Copy / paste lines: decided by the target layer only.**
   - A clip carries no reliable source 元组件: its source is a view, two documents may both have a layer id "L", and one copy may span several layers (dot 1791655027). So nothing is guessed from the source.
   - The rule looks only at the target layer: each pasted line and each wholly pasted curve keeps its name if that name is free there, else gets "<name>副本" (then 副本2…).
   - Pasting back into the layer it came from therefore still gives 副本 (the originals hold the names), as the graph row says. Into a layer where the name is free, it is kept.
   - Example (dot 1791655111): copy a line, then delete or rename the original; pasting back into the same layer then keeps the original name, since it is free again. This is not "a same-layer paste always gets 副本".
   - **The defaults given while pasting never push out a name that could be kept** (dot 1791655027): `copyFrom` first clears the temporary defaults of every pasted line and curve, assigns the kept names, then the 副本 names, and only then fills defaults for anything still unnamed.
6. **Cut and paste keeping ids** (`moveGroup`): names are decided by the target layer, like a paste (dot 1791655253, replacing the earlier "refuse"). With per-layer defaults every layer has "曲线1", so refusing would make normal cut and paste fail.
   - Ids and every view's data stay. The move, any needed rename and a later merge are one edit and one undo step.
   - The names free in the target are reserved for the whole moving batch first; then the movers whose names are taken get "<name>副本…", so a 副本 name never takes a name a later mover could keep. Lines and the curve are checked together. The plan is made before the move and any merge.
   - If the move then makes end points coincide and curves merge, the existing merge survival rules decide which curve id and name survive. Curve ids are not promised to stay (dot 1791655027).
7. **Type** (`meta`).
   - A layer's type is a string; "" means none (*proposal*).
   - Setting it is an edit: one undo step, no geometry.
   - It is refused for a missing layer.
8. **Lookup.** `core.lineByName(layer, name)` gives the line id, or nothing. It is a read, no state.
9. **No second state.** meta's data (types by layer id) is a part of the one document state: the same draft, rollback, undo and save as every module.
   - meta holds only rules and its own part, opaque like the others.
   - Lines' names stay in `names`; meta reads them.

## Write paths

| Operation | Writes | Checks |
|---|---|---|
| `renameLine` / `renameGroup` | names | free within the layer; a locked line refuses (as now) |
| `renameLayer` | network (layer record) | free among layers |
| default names (every topology step, at settle) | names | per-layer numbering |
| `copyLayer` | network + shapes (clip), names (kept inside; layer gets 副本), meta (type copied) | — |
| paste (`insertClip`) | names via `copyFrom` by rule 5 | per target layer |
| `moveGroup` | network (points' layer) | names free in the target layer, else refused |
| `layerType` (new) | meta | the layer exists |
| `deleteLayer` / a layer removed when empty | meta drops the layer's type at settle | — |
| commit | — | `names.check`: per-layer uniqueness of lines and curves; uniqueness of layer names |

## Read paths

| Path | Reads |
|---|---|
| snapshot | layers carry `type` (meta); lines and groups carry `name` (names) |
| `lineByName(layer, name)` | names, filtered by the line's layer (network) |
| open (archive) | names: every line and curve named once, per-layer unique. meta: a type for existing layers only, values are strings |
| clipboard extract | names `rangeData` (unchanged) |

## Tests

- Per-layer scope:
  - the same line name in two layers is allowed, and refused within one;
  - a layer may share a name with a line;
  - layer names stay unique.
- A rename keeps every view's shape and the id; `lineByName` follows the new name.
- Copy layer: the inner names are unchanged, the layer is "<name>副本", the type is copied.
- Paste into the same layer gives 副本; into another layer the name is kept when free, 副本 when taken.
- moveGroup into a layer where a name is taken is refused, and writes nothing.
- A layer type set and undone is one step; save / open keeps the types; a type on a missing layer is refused at open.
- Defaults are numbered per layer.
- The tests of the old document-wide rule (names acceptance 2, 5, 7, 10b) are updated explicitly where the rule changed.
