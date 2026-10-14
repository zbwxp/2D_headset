# Corrections: no copy on paste, one row per curve, delete a curve's or a layer's corrections — checklist before code, for dot's review

## The ask
- **bowen 1791993536:**
  - copy / paste does not copy corrections;
  - the corrections list shows one row per continuous curve (the layer's first level), because one row per point and handle is too many to tell apart.
- **bowen 1791993161:**
  - with only the right eye's layer lit, the list let him delete the left eye's and other lines' corrections;
  - deleting is per line or per layer, all of it.

## The cause it answers (dot 1791992564, 1791992705; bowen 1791993178)
- The right eye was pasted from the left one, then moved or flipped in each view.
- Paste had copied the left eye's knots (ratios). On the right eye's spans they mean far other positions: a lash point's ratio of about 32 moves it about 390.
- Deleting them point by point at one angle left others (bowen 1791993484).

## 1. Paste carries no corrections
- **Copy:** the clip no longer holds `animation`. **Copying a layer** (`copyLayer`) carries none either (dot 1791995359).
- **Paste:** writes no knots. A clip that still holds `animation` (made before this) is still checked, as today, so a bad one refuses the paste; it is then not written.
- **The pasted lines** therefore blend linearly between the views until corrected.
- **Unchanged:**
  - cut-and-paste: the first paste after a cut moves the lines (same ids), so they keep their knots; any later paste is a new copy, without knots (dot 1791995359: tested separately);
  - mirror apply never wrote knots;
  - links and their identical response sets are untouched (a clip never carries links).

## 2. Core: `Editor.clearCorrections(controls)`
- **What it removes:** every knot of the given controls (points and handle ends), on every edge, both axes.
- **Points:** a point stands for its link component, as in `uncorrect` (linked points hold identical sets).
- **Views stay:** a view that a correction moved stays where it is, as in `uncorrect`.
- **Refused:**
  - an unknown control (`correction-bad-target`);
  - nothing to remove (`uncorrect-none`).
- **Bookkeeping:**
  - one edit, one undo step;
  - effects as `uncorrect`: `reads: draft`, `shared: animation`, `settle: none`;
  - allowed in playback by the gate, like `uncorrect`;
  - locks are not consulted (as `uncorrect`; bowen 1791903940).

## 3. Bench: the list at a correction pose
- **One row per curve** with any knot at *any* angle (dot 1791995359: a curve corrected only at another angle is still found here and cleared whole). The row shows both counts: this angle and all angles. A curve is the group a line belongs to, else the line alone; this is the layer's first level, as the layers panel shows it.
  - The row shows the curve's name and how many controls have knots here.
  - A curve's controls are its lines' end points and their handles.
- **Only the selected layers' curves are listed** (bowen 1791993161).
- **「删除这条曲线的全部修正」** on a row: one `clearCorrections` with all the curve's controls, *all angles*. bowen 1791993161 asked for a line's corrections all deleted; this angle only is the open question in 1791993568.
  - **Not only the selected layers can be touched** (dot 1791995359). The row and the note under the list say so:
    - a point shared with another curve (a junction) loses its knots for both;
    - a point linked across layers loses them for its linked members, which may be in an unselected layer.
- **「删除选中图层的全部修正」:** one `clearCorrections` with every point and handle of the selected layers, all angles.
- **Rings and handle marks** at this pose stay as today: per point and handle, selected layers only.
- **「刚才改了什么」** lists what was removed, as for `uncorrect`.

## 4. Evidence
**Core:**
- **`clearCorrections`:**
  - knots on several edges and both axes all go;
  - a linked member's knots go too, and the sets stay identical;
  - views stay;
  - undo brings them back;
  - refusals;
  - other controls' knots are untouched.
- **Paste:**
  - a pasted copy of a corrected curve has no knots and blends linearly;
  - an old clip with `animation` pastes without knots;
  - an old clip with a bad `animation` is refused.

**Bench:**
- at yaw 30 with only the right eye's layer selected, the list shows only right-eye curves, one row each;
- the row's delete clears that curve on every edge;
- the layer button clears the layer;
- the left eye's knots stay.

**bowen's 172.json (dot):**
- after clearing the right eye's and right lashes' layers, the pitch −45 edge at yaw 23 is the linear blend;
- the left eye is unchanged.
