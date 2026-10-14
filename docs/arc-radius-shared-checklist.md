# One arc radius per join, in every view: checklist before any code, for dot's review

**Ask** (bowen 1791985326):
- **The bug:** an arc's radius is stored per view. A change in one view leaves the others at their old value (10, the bench's default when the arc was made), and so does every pose in between (yaw 30 blends 10s). He has to change it in every view.
- **The rule:** a change of an arc's radius in any view changes it for the whole meta-curve (元曲线). At least for the arc radius, the meta-curve may not hold another value.
- **Old files:** where the views disagree, the front view (0, 0) wins.

**What it replaces:** step 4 rule 1 and rule 2, last line (`docs/step4-per-view-joins.md`, dot 1791654260): "Radius … live[s] in every shape layer"; "Changing the radius later changes the current view only". Those were implementation choices; bowen's rule now decides.

**Unchanged:**
- the transition-zone length stays per view (bowen 1791810585) and blended over the pose (bowen 1791811981);
- end strokes stay per view (step 4 rule 3).
If bowen wants these shared too, it is the same change applied to them; not in this round.

## 1. Storage: the radius is part of the join row
- An arc row holds its radius beside its mode: `{ point, lines, mode: 'arc', radius }`. It is the same in every view because there is only one.
- Rows of other modes hold no radius. Changing a row away from arc drops it.
- The shape layers no longer have a `radius` slot (`shapes` keeps `zone` and `end`).

## 2. Writes
- `join(point, l1, l2, { mode: 'arc', radius })` in **any** view sets the row's one radius. Every view, and every pose between them, then reads that radius.
- `setRadiusHere` goes. Its one caller is `posedState` (the stage 3a scratch layer): with a shared radius, the scratch layer reads the row as every view does.
- **`arc-needs-owner` goes.** That refusal existed because expression / record layers had to be filled with a per-layer radius by their owners (dot 1791654154). With nothing per layer to fill, an arc is set without them.
- **Structural changes** (`joins.update`: split, bind, unbind, delete): the radius travels inside its row. The keep / move / drop decisions do not change.
- **Mirror apply** (front only): the copied row's radius is the shared one, so the target row gets it in every view. The step 4 addition "keeps the other views' radii" no longer applies: there are none.
- **Copy / paste:** the clip's rows carry the radius. The clip's per-layer data loses `radii`, keeping zones and end strokes. A clip in the old form (radii per layer) is refused as a bad clip. Clips are not saved files, so no reader for the old form.

## 3. Reads
- `rows`, `rowsAt` and `governing` give the row's radius, whichever view they are asked in. The ink trim (`derived`) and the bench join panel are unchanged.
- **evaluate:** the radius is no longer a per-view value to blend.
  - `Model.views[].radii` and `Posed.radii` go.
  - The posed reader takes the radius from the row, so every pose reads it exactly (no blend of equal numbers that could differ in the last bit).
  - `Core.model()` loses the per-view radii accordingly.

## 4. File: archive version 11 → 12
- **v12:** arc rows carry `radius`; shape layers have no `radius`.
- **The reader checks:**
  - every arc row has a finite radius above zero;
  - no other row has one;
  - no shape layer has a radius.
- **`legacy.fromV11`** (disposable, as the other legacy steps; bowen 1791907735), in two steps (dot 1791985599):
  1. **First, v11's own radius checks, on every shape layer:**
     - every arc row has a radius in every layer;
     - no radius belongs to anything but an arc row;
     - every radius is a finite number above zero.
     A file that fails is refused as v11 would have refused it. The values of the other views are no longer used, but invalid old data is not dropped to make a file open.
  2. **Then:** every arc row takes the front view's (`view:0,0`) radius for its key, and every shape layer's `radius` is removed.
  - A missing or invalid front value is refused, never filled with a default (no 10).
- Older files go through the existing chain and then `fromV11`.

## 5. Effects
Only the declarations caused by the radius go (dot 1791985599). Everything else stays:
- a smooth join still turns handles in every view;
- `removeJoin` still clears every view's zone.
The effects test lists them so.

## 5b. Playback: changing an arc's radius at 30° (dot 1791985670)
- **Today:** the playback gate refuses `join`, so the panel cannot change a radius at 30°.
- **The gate lets through an edit made only of `join` calls that change the radius of an existing arc.** For each call:
  - the row at that point and those two lines exists and is an arc;
  - the call's mode is `arc`.
- **Still refused:** a new join, a mode change, anything else.
- Since the radius is one value, the change is the same at every view and pose.

## 6. Evidence
**core:**
- **Arc in every view:** set at the front with r = 10, then changed in view 90,0 to 4: every view reads 4, and so do poses yaw 30 and yaw −60 / pitch 45. One undo step brings 10 back everywhere.
- **Mode change:** away from arc, the radius is gone; back to arc, the new radius is given.
- **Split / bind / unbind / delete:** the row and its radius go together (the existing joins tests, with radius assertions per row).
- **Mirror apply:** the target arc gets the source's radius in every view.
- **Copy / paste:** the radius round-trips; an old-form clip is refused.
- **Archive:**
  - a v12 save / open round trip;
  - a v11 file whose views hold 10 (front) and 4 (side) opens with 10 everywhere;
  - a v11 file with equal values opens unchanged;
  - v12 files with a radius in a layer, or a missing / extra row radius, are refused.
- **`arc-needs-owner`:** no longer refused (the test that expected it changes).

**bench:**
- at yaw 30 in playback, the panel's r changes an existing arc: one `join` call; the nine views and the pose all read the new radius (dot 1791985670). A new join or a mode change at 30° is refused.

**bowen's 145.json (dot 1791985599):**
- list its arcs' radii per view as stored (v11);
- after opening: every view and the poses between read the front's value;
- a screenshot of the front and of yaw 30.

**bench (5199):**
- an arc's r changed in view 90,0; the front and playback at yaw 30 show the same arc;
- a screenshot of the front and of yaw 30 after the change.

## 7. Not in this round
- zone and end strokes shared (see "Unchanged");
- a radius correction per pose (bowen's rule forbids other values on the meta-curve).
