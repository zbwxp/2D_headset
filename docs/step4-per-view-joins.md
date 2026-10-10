# Step 4: arc radius and end strokes per view (plan before code)

**Status:** checked by dot 1791654260 with four additions (below); coding starts with them.

## Rules

1. **Storage.** Radius and end stroke live in every shape layer of `shapes`, under opaque keys:
   - a radius under its join row (point + the two lines, in joins' stored form);
   - an end stroke under its point.

   The join mode stays shared in `joins`.
2. **Setting an arc join.** The mode is shared.
   - The current view gets the given radius.
   - Every other **view** layer that has no radius for this row gets a copy of the same value (a default; proposal).
   - A view that already has one keeps it.
   - Expression and record layers are not filled here. Their owners do it, and until they exist the arc set is refused if such layers exist (dot 1791654154).
   - Changing the radius later changes the current view only.
3. **Setting an end stroke.** The current view only.
4. **Structural changes.** When a join row is re-keyed or removed by a split or a bind, every layer's radius follows (re-key or remove). When a point is removed, every layer's end stroke for it is removed.
5. **Mirror apply** (front only) copies the front's radius and end strokes into the front.
6. **Copy / paste** carry each layer's own radii and end strokes (clip shape layers), never only the source layer's (dot 1791654154). Pasting uses the same layer correspondence as the shapes (step 2).

## Additions (dot 1791654260)

1. **Mirror apply** no longer removes all target joins and then rebuilds them.
   - An arc row that still exists afterwards keeps the other views' radii; only the front's value is written.
   - A row is removed only when it is really gone, or no longer an arc.
2. **Structural changes**, unbind included, keep exactly the keep / move / drop decisions of `joins.update`; each layer's value follows its row.
   - A bind still drops the removed point's joins; they are never moved to the kept point.
   - A split that changes the order of a row's two lines re-keys it.
3. **Keys and references belong to `joins`; `shapes` only stores values.** Open checks:
   - radii that dangle or are missing;
   - end strokes on points that do not exist;
   - radii must be finite and above zero.

   "Open does not settle" applies only to these attributes; step 3's checks of view positions and links stay.
4. **Clipboard `attach` / `joins.insert`** get the same layer correspondence as the shapes insert, so attributes are written in every layer, not only the current one.

**Acceptance:** different values per view, covering mirror keeping other views' radii, unbind, split re-keying, copy / paste, and save / reopen.

## Read paths

| Path | Reads which layer | Settled or not |
|---|---|---|
| derived arc trimming (geometry, picking, fill outlines) | the layer the caller's handle is bound to | commit: settled; trial: view() settles every view |
| lock comparison (end stroke at a free end) | each view checked | before and after the edit |
| snapshot (joins with radius, endStroke per point) | the view of `in(view)` | the published state |
| clipboard extract / insert | every layer, by the layer correspondence | copy: published; paste: written, then settled |
| mirror apply | the front | the trial |
| open | every layer: integrity and valid values only | not settled |
| joins.update (re-key on structural changes) | every layer | at the structural operation |

## Tests

- One per path, mainly "a side-view change leaves the front unchanged".
- Radii follow splits and binds in every layer.
- Copy / paste carry each view's own values.
- The arc set is refused while expression or record layers exist.
