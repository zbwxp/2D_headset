# Every stroke value on the meta-curve, one for all views: checklist before any code, for dot's review

**Ask:**
- bowen 1792057240: "所有起点终点宽的笔触都应用到元曲线上（也就是所有视角同时同步）".
- bowen 1792057731: "如果没有了那么所有笔触就都归元曲线"; the transition-zone length too ("是的").
- dot 1792057535: list each value's storage and old-file rule, and review the migration. Do not sync the UI while different per-view values remain underneath.

**Review (dot, after 9c7cf05):** storage and "check all old data, then migrate" accepted; the three behaviours as proposed (mirror from any view with the lock checks kept, split by the edit's view, playback lets the five stroke calls through with targets, locks and undo checked, no new join / mode change). Wording fix taken in §3: what is shared is the manual zone and the automatic *desired* length; the actual length in `zones()`, limited by the lines' lengths, still varies by view and pose.
**bowen:** "旧稿按照0，0 的为准" — old files take the front's values, side-only end strokes and zones included (§4).

**What it replaces.** These earlier rules were implementation choices; bowen's rule now decides:
- strokes per view (bowen 1791650085);
- step 4 rule 3 (end strokes per view, `docs/step4-per-view-joins.md`);
- the zone per view and blended over the pose (bowen 1791810585 / 1791811981);
- step 6's stroke broadcast;
- `evaluate`'s appearance slot A, where width, profile and end strokes jump at the dominant view (ledger row 9, its appearance half).

The arc radius already works this way (c707f35, `docs/arc-radius-shared-checklist.md`). This round does the same for the rest.

## 0. What is per view today (all of it goes)

| value | stored today | read through |
|---|---|---|
| point width (a line's 起点宽 / 终点宽 are its two points' widths) | `shapes` layer `widths[point]`, in every shape layer (views, expression, record) | `net.pointWidth`, `line.stroke.width / widthB` |
| line profile (only `'uniform'` exists) | `shapes` layer `lines[line].stroke.profile` | `line.stroke.profile` |
| end stroke (a free end's `taper`; an open dictionary) | `shapes` slot `end[point]` | `joins.endStroke` |
| manual transition-zone length | `shapes` slot `zone[rowKey]`; absent = automatic `autoZone(widths)` | `JoinRow.zone`, `zones()` |

What stays per view: point positions and handle vectors. After this round, `shapes` holds nothing else, and its `zone` and `end` slots go.

## 1. Storage: one value each, beside what it belongs to
- **Point width.** On the network's point record: `{ id, layer, width }`. Every point has one, finite and above zero. A new point gets 1, as today.
- **Line profile.** On the network's line record: `stroke: { profile }`.
- **End stroke.** In the joins store, `ends: { [point]: EndStroke }`. Keys stay sorted, so one content has one stored form, as today.
- **Manual zone.** On the join row: `{ point, lines, mode, radius?, zone? }`. It belongs to every mode, so a mode change keeps it (dot 1791811393), as today.
- **Ledger row 10 closes here.** The `EndStroke` type loses `undefined` values: `{ taper?: number; [key: string]: number | string }`. Readers no longer filter.

## 2. Writes: from any view, every view changes
The calls do not change: `pointWidth`, `lineStroke`, `stroke` (group), `endStroke`, `zone(…, null | length)`. Each now writes the one value, and one undo step brings back the old one everywhere.

The calls are bound to a view as today, but that view no longer matters for them. In detail:
- **Locks:** unchanged. A locked line's widths and profile are not changed; the group `stroke` skips points a locked line ends at.
- **Mirror (front only today).** Mirror-linked lines are edited together. Outside the front, `paired` refuses with `mirror-front-only`.
  - **Proposal:** for these five stroke calls, the refusal goes, so both sides change together from any view. That rule exists because positions differ per view; a shared value has nothing per view to protect. Without this, a mirrored eye's width could not be changed from the side view, which contradicts "在任何视角改".
  - **For dot:** agree, or keep stroke edits of mirror-linked lines front-only?
- **Mirror apply (front):** it copies widths, profile and end strokes to the target as today. The target now takes them in every view, not only the front.
- **Split.** Today each layer gives the new point its own width, linear in arc length along that layer's curve. Now there is one width.
  - **Proposal:** use the arc-length fraction of the curve in the view the split is made in. The line then draws exactly as before there; elsewhere the width at the cut may differ by the views' arc-length difference.
  - **For dot:** this or the front's curve?
- **Unbind / insert / copy layer:** the new point copies the old point's one width. Same rule as today, one value.
- **Structural changes** (`joins.update`): a zone travels inside its row, and a dropped row drops it (as the radius does). A deleted point's end stroke goes.
- **Removed:** `views.broadcastStroke`, `Editor.broadcastStroke`, `interaction.broadcastStroke`, its effects row, and the bench button 「Broadcast stroke」. With one value there is nothing to broadcast.

## 3. Reads and playback
- **Views.** `line.stroke`, `pointWidth`, `endStroke` and `rows()[].zone` give the shared value in every view. The automatic desired length follows the widths, so it is equal in every view too. `zones()` gives the actual length, limited by the lines' lengths in that view, so it still varies by view and pose (dot).
- **evaluate.**
  - `Model.views[]` loses `lines[].stroke`, `zones` and `ends`; it keeps positions and handles.
  - `Posed` loses them too. `appearance` (slot A) goes, so nothing jumps at the dominant view any more.
  - The posed reader reads widths, profile, end strokes and zones from the shared store, like the radius. `posedState` writes only positions and handles.
  - `Core.model()` shrinks accordingly. The bench's change base compares it as before.
- **Playback gate.** Today it refuses every stroke call; only an arc's radius goes through (§5b of the radius checklist, dot 1791985670).
  - **Proposal:** for the same reason, `pointWidth`, `lineStroke`, `stroke`, `endStroke` and `zone` (set or automatic) are allowed at any pose. Each writes the one value.
  - `join` / `removeJoin` stay refused, except for the radius rule.
  - **For dot:** agree?
- **Copy / paste.** The clip carries one width per point, one profile per line, the rows' zones and the points' end strokes. Its per-layer data keeps positions and handles only. A clip in the old form is refused as a bad clip. Clips are not saved files, so there is no reader for the old form.
- **Effects.**
  - `lineStroke`, `pointWidth` and `stroke` become `shapes: 'none', shared: ['structure']`.
  - `endStroke` and `zone` become `shapes: 'none', shared: ['joins']`.
  - `removeJoin` stops writing shapes.
  - The effects test lists them so.

## 4. File: archive version 13 → 14
- **v14:**
  - points carry `width`;
  - lines carry `stroke: { profile }`;
  - join rows may carry `zone`;
  - joins carry `ends`;
  - shape layers carry only `points` (positions) and `lines` (`ha`, `hb`), with no `widths`, `stroke`, `zone` or `end`.
- **The reader checks:**
  - every point has a finite width above zero;
  - every line has a profile string;
  - every zone is finite and above zero;
  - end strokes are only on existing points, with finite numbers or strings, and `taper` a number ≥ 0;
  - nothing per view is left in a shape layer.
- **`legacy.fromV13`** (disposable, as the other legacy steps), in two steps, as `fromV11` (dot 1791985599):
  1. **First, v13's own checks on every shape layer**, views, expression and record alike:
     - a width for every point, finite and above zero;
     - a profile for every line;
     - zones only under existing rows, finite and above zero;
     - end strokes only on existing points, with valid values.
     A file that fails is refused as v13 would refuse it. Invalid old data in a side view is not dropped to make a file open.
  2. **Then every value takes the front's (`view:0,0`):**
     - **width / profile:** the front's value;
     - **zone:** the front's manual zone if it has one, else none (automatic). A manual zone set only in a side view is dropped.
     - **end stroke:** the front's if it has one, else none. One set only in a side view is dropped.
     - every per-layer copy is removed.
     - A missing or invalid front value is refused, never filled with a default.
- **Lossy where views differ.** Where views differ, the side values are lost, as with the radius. This is bowen's rule ("正面为准" for the radius); I apply it to these four as well.
  - **For bowen (via dot), if wanted:** a count of how many values differ, on a file he names, before he opens it with the new version.
- Older files go through the existing chain, then `fromV13`.

## 5. Unchanged
- **Positions and handles:** per view.
- **Arc radius:** already shared.
- **Join modes and order, fills, masks, locks, links, corrections:** unchanged.
- **The ink:** unchanged. It reads the same `stroke` and `zones` as before.
- **Ledger row 20 stays:** two lines meeting at a point are always equally wide there, so the automatic zone is that width. This round does not change the zone's meaning.

## 6. Evidence
**core:**
- **Each of the four values:** set in view `90,0`, then read in all nine views, at poses yaw 30 and yaw −60 / pitch 45, and on an expression and a record layer: all equal. One undo restores all.
- **Line widths:** `lineStroke` with `widthB` from view `0,45`: both points' widths change everywhere, and so does every other line at those points.
- **Locks:** unchanged (the existing tests, with an all-views assertion).
- **Mirror:** per dot's answer on §2. Either a side-view width edit of a mirror-linked line changes both sides everywhere, or it is refused as today. Mirror apply then writes the target in every view.
- **Split:** per dot's answer. The new point's width is the chosen view's arc-length value; in that view the line draws as before.
- **Structural (split / bind / unbind / delete):** zones travel with rows and end strokes with points (existing joins tests, with all-views assertions).
- **Copy / paste:** the four values round-trip; an old-form clip is refused.
- **Archive:**
  - a v14 save / open round trip;
  - a v13 file whose views differ (width 2 front / 5 side; zone 3 front / 7 side; a side-only manual zone; a side-only end stroke; a front end stroke with taper 2 and the side's taper 4) opens with the front's values everywhere and the side-only ones gone;
  - a v13 file with equal values opens unchanged;
  - v13 files invalid in a side layer are refused;
  - v14 files with leftovers in a layer, or missing or invalid widths or profiles, are refused.
- **evaluate:** posed widths, profile, zones and end strokes are exactly the shared values, with no jump across the dominant-view boundary (yaw 44 vs 46).
- **Effects:** the declarations as in §3.
- **broadcastStroke:** gone from the API (the interaction API test lists it).

**bench:**
- the 「Broadcast stroke」 button is gone;
- changing a width in view `90,0` shows in the front without any other step;
- in playback at yaw 30 (if §3 is agreed), a width change is one call and every view and the pose read it;
- rendered image: one drawing at three views and one pose, before and after a width change made in one view.
