# Masks (蒙版) — package 1: the geometry and the drawing (checklist before any code, for dot's review)

Decisions: walkthrough Q33 (headset-design 9ce5767, c270cc7, 2b2a32f) — bowen 1791901391 (甲; no view control; lines and fills), 1791901604 (sources: fills only; a mask acts while its source fill is on), dot 1791901344 / 1791901708; the effect confirmed on 126.json (bowen 1791902206). Graph rows: drafted in Q33, written when bowen says 写.

Packages: **1** the geometry and the drawing (this); **2** the relations in core (stored in the drawing, reference upkeep on delete / copy / paste / rename, the archive); **3** the UI (make, list, remove a mask) and picking that follows what is drawn.

## 1. A new package `visibility/` (the 显隐 module; bowen 1791901097)
- Plain geometry on plain data, like `deform/`; its only import is `clipper2-ts`, as `ink/`. Line display intervals join it later.
- `area(parts)`: a filled loop's area as polygons — its boundary cubics (the fill's `parts`, as drawn in the view) flattened to a tolerance in drawing units, on the ink's integer grid.
- `apply(target, relations)`: a target's polygons (a line's ink outline, or a fill's area) and its relations → what stays visible. Per relation: the union of its sources that are on (dot 1791901708); with none on, the relation is skipped (not "an empty area"). Inverse = target minus that union; normal = target ∩ that union. Several relations: applied one after another (each only removes, so the order does not matter).
- **Sources read before any mask** (Q33): `area` takes the source fill's own boundary, never a masked result — mutual masks cannot loop.

## 2. The ink and the fills (`ink/`, the bench)
- **Ink, per line (dot 1791901344):** the ink builds each line's piece, then unites a join group's pieces. A masked line's piece is clipped **before** the union, so a mask on one line never clips its neighbours in the same group. Arcs' pieces are not masked in this package (recorded; they are not lines).
- **Fills:** a masked fill is drawn as its clipped polygons instead of its boundary path.
- **On / off:** a source fill counts when it is filled and shown (`loops[].filled && visible`), read from the drawing before any mask.
- **Each view uses its own geometry** (Q33): the areas and the ink come from the view shown.

## 3. In the bench, for this package only
- The relations come from a temporary bench store (`window.bench.masks`, not saved) until package 2 stores them in the drawing; a 「蒙版（实验）」 switch beside 墨迹轮廓 turns the drawing of masks on.
- **Picking is not changed yet** (package 3): until then a hidden part can still be picked — stated in the hand-in.

## 4. Evidence
- `visibility/test`: inverse and normal on squares (exact areas); a relation whose sources are all off changes nothing (a normal-mode target does not vanish); two relations in either order give the same result; a fill's area matches the polygon of its flattened boundary within the tolerance.
- Ink: a masked line in a join group — its neighbour's outline unchanged.
- **126.json, all nine views, rendered PNGs** (dot wants images): the side-face lines masked by the face fill (inverse), the face lines masked by the side-face fill (inverse) — compared with bowen's confirmed picture (1791902206); front views: the side-face line gone.
- Mutual masks: each source read unmasked — both relations at once give the same as each alone on its own target.

## 5. Not in package 1
Storing relations (package 2), the UI and picking (package 3), lines' stroke areas as sources, stroke intervals (with display intervals), arcs' pieces.
