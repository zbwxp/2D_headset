# Step 5: name scope and meta (plan before code)

**Status:** for dot's check (dot 1791654857 asked for rules and read / write paths first). Nothing is coded until dot has checked it.

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
   - Line names and continuous-curve names: unique within their layer, non-empty.
   - Different scopes do not collide: a line may share a name with a layer, or with a line in another layer.
2. **Rename keeps identity.**
   - A line is identified internally by its id. A rename changes only the name, so its nine views, its expressions (later) and every reference stay attached.
   - The 元线条 identity (layer, name) follows the rename.
3. **Default names.** "曲线N" / "连续曲线N", where N is the next number free **within the layer** (*proposal*; it was document-wide).
4. **Copy a whole layer (元组件).**
   - The new layer's name is "<name>副本" (then 副本2…; layer names are document-wide).
   - Every line and continuous curve inside keeps its name.
   - Its type is copied.
5. **Copy / paste lines.**
   - Into the **same** layer: the copies get "<name>副本" (then 副本2…), as now.
   - Into **another** layer: a name free there is kept; a name taken there gets "<name>副本…" (*proposal*).
6. **Cut and paste keeping ids** (`moveGroup`): the moved lines and curve keep their names. If any of those names is taken in the target layer, the move is refused (`name-taken`). It is not renamed silently, since the case is not defined.
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
