# Reference images — rules before code

**Status:** direction accepted by dot 1791701244, with the four boundaries of §7 added; scope kept small (no CRC walk, masks or slots). **Coded** for dot's check: `src/reference/index.ts`, the `reference` part and three operations in `src/document`, archive 5, the bench's Reference panel; tests `test/reference.test.ts`, `bench/test/reference.test.tsx`, the cases in `test/effects.test.ts`. **Not tested:** the status error for a stored picture that fails to draw (jsdom fires no SVG image error); the code sets it from the `<image>` element's `onError`.

**Asked by bowen** 1791700171, 1791700193 (v2's background reference images, in the new version, a separate module, no editing), 1791701099 ("独立package做差不多能用就行 之后可以再优化": roughly usable first, optimise later). **v2 for reference:** `4bc7cc2`, `proto/base` (`schema.ts` `ImageRecord`, `imageCommands.ts`, `imageData.ts`, `ui/imagePanel.tsx`, `view/images.ts`).

**Defaults of this version, not choices bowen has made** (asked 1791700309; dot 1791701244): one image belongs to **one view**, shown only there; **not shown in playback**.

**Ledger check:** no row triggered. Row 6 (read entries) gets one read (`references(view)`), reviewed below.

## 1. What it is

- A picture to draw over, never part of the drawing: no points, lines, picking, snapping, fills, links or joins.
- Fields: `id`, `view` (one of the nine view keys), `src` (an embedded `data:image/png|jpeg|webp;base64,…` URL), `width` and `height` (pixels), `x`, `y` (its centre, drawing units), `scale` (drawing units per pixel, > 0), `angle` (degrees), `opacity` (0–1), `visible`.
- Drawn under every line of its view, centred at (x, y), `width · scale` by `height · scale`, rotated by `angle`.

## 2. Where it lives (dot 1791700377)

- **A new module `src/reference`**, owning a state part `reference` in the document's `State`, like `animation`. It is in the same draft, rollback, undo and file; no mutable state anywhere else.
- **Operations** (Editor): `placeReference(id, view, image)`, `setReference(id, props)`, `removeReference(id)`.
- **Declarations:** reads `draft`; intents and shapes `none`; records `false`; shared `['reference']` (a new shared part); `autoStructure: false`; `settle: 'none'`; not alone. So an edit of reference operations (with or without selections) commits in the `keeps` mode: no settle, no auto-bind.
- **Read:** `LayerReader.references()`, the images of that view, as plain copies. `PoseReader` has none (the default above: not in playback).
- **Not carried:** copy / paste and copy layer do not carry images (they belong to views, not lines).
- **File:** archive version 5 (decided policy: no old-format compatibility, `docs/archive-plan.md`). **Version-4 files will no longer open**; bowen is told before this lands.

## 3. Checks (refusals, `reference-*`)

Kept to v2's level that matters here, without its full PNG chunk walk ("roughly usable"):
- `src`: a data URL of PNG, JPEG or WebP, base64, at most 100 000 000 characters (v2's `maxSrcLength`); its first decoded bytes match the type's signature (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF … WEBP`) — `reference-bad-image`.
- `width`, `height`: integers 1–16 384 (v2's `maxSide`), `width · height` ≤ 16 384² — `reference-bad-size`.
- `x`, `y`, `angle`: finite; `scale`: finite and > 0, and `width · scale`, `height · scale` finite (so a stored image can be drawn); `opacity`: 0–1; `visible`: boolean; `view`: one of the nine — `reference-bad-value`.
- `id`: a new id for `place` (`reference-exists`), an existing one for `set` / `remove` (`reference-unknown`).
- The same checks at open (a file failing them is refused, `open-failed`).
- **What the checks do not cover:** a matching signature does not prove the picture decodes; core never decodes. The bench decodes before placing, and a picture that does not decode is not placed (a status message, nothing written). A stored picture that fails to decode when drawn (e.g. from a file) shows an error in the status line; the drawing and its editing are unaffected.

## 4. The bench

- A **Reference** panel, in the editing fieldset (disabled in playback, and the playback gate refuses every non-`correct` call anyway): **Place…** (file input, PNG / JPEG / WebP), then, for each image of the current view: opacity, x, y, scale, angle, visible, remove.
- **Placing:** the file is read and decoded asynchronously. The read binds the drawing (`core` and its saved text) and the view at its start; if either changed when it returns, it is dropped with a log row, nothing written. Initial placement as v2: native size, centred in the view's box, shrunk to fit 90% if larger; opacity 0.5.
- **Drawn** as an SVG `<image>` before the fills and lines, only in its view, never in playback.

## 5. Tests

- **Core:** each refusal (bad type, wrong signature, too wide, bad numbers, unknown view, duplicate / unknown id); place, set and remove are one undo step each; an edit of reference operations commits in `keeps` mode, with every point, line and the other parts byte-identical, and two coincident points of one layer (opened from a file) staying two; a file round-trips its images; a file with a bad image does not open; a clip carries no images; `references(view)` returns only that view's images.
- **Bench:** placing shows the image in its view and not in another or in playback; a read that returns after a view change, or after another drawing was opened, writes nothing; in playback the panel and the gate write nothing.

## 7. Boundaries added (dot 1791701244)

1. **Late reads:** each App has its own counter, advanced by a view change, entering or leaving playback, an Open and unmounting; a read keeps the counter, `core`, its saved text and the view from its start and writes only if all are unchanged. A switch away and back still drops it. Tests: back-and-forth view switch, playback in and out, unmount.
2. **Drawable size:** `width · scale` and `height · scale` finite (§3).
3. **Decoding:** as §3's last item.
4. **Mixed edits:** only an edit of reference operations (with or without selections) skips the settle. Mixed with a `move` it settles fully as any edit does; beside `correct` or another alone operation it is refused (`stage2-alone`). Whether an operation may stand beside an alone one is declared (`companion`, true only for selections and stroke broadcasts), not inferred from `settle: 'none'` (dot 1791701744). Tests for each mix.

## 6. Not now

Dragging on the canvas, masks, position slots, the colour picker, images in playback, images shared by all views (all possible later, bowen 1791701099).

## 8. Second round: live adjusting, moving on the canvas, position slots (bowen 1791702887)

**Asked:** the panel's settings shown on the canvas as they change; a mode to grab the picture with the cursor or nudge it with the arrow keys; v2's position slots. Understanding posted to bowen 1791703246; built at the "usable first" bar (bowen 1791701099).

1. **Live adjusting (bench only):** x, y, scale, angle and opacity get sliders beside the number fields. While a slider is dragged or a field is typed in, the picture is drawn from a **preview** held by the bench (no core call); release, Enter or leaving the field commits **one** `setReference`, one undo step (as v2's slider: one drag, one step); Esc reverts the preview. The preview is bound to the drawing and the picture's source (as §7.1 and the error state) and dropped on any change of drawing, view or mode.
2. **Move mode (bench only):** a **Move picture** toggle in the Reference panel, off by default, off in playback.
   - On: a press on a visible picture of the current view (inside its rotated rectangle; topmost first) starts a drag; the picture is previewed at its start + the pointer's displacement; the release commits one `setReference` (x, y). The press binds the frame's drawing (as the playback drag, `docs/stage3b-pkg5-problems.md` §2); a changed drawing at the release writes nothing. The one gesture slot and its cancel paths apply (Esc, right click, pointercancel, blur, another press of the same pointer in any App, view change, unmount).
   - The last picture pressed (or chosen in the panel) is the **active** one; the arrow keys nudge it by 1 drawing unit (Shift: 10), one undo step per key, before interaction's own arrow-key handling and after the typing guard (a focused field keeps its arrows).
   - Lines, points and fills are not picked while the mode is on; turning it off returns presses to the current tool.
3. **Position slots (core):** each picture gets `slots`, a list of at most 1000 `{ name, placement }`, placement `{ x, y, scale, angle } | null` (v2's 存 / 调出 / × / rename / 加一格).
   - Written through `setReference(id, { slots })` (checked as a whole: names strings ≤ 100 characters, placements as §3's numbers); **save** writes the current placement into a slot, **recall** writes a slot's placement into x, y, scale, angle; each one undo step.
   - **File:** `slots` is part of version 5. A version-5 file without `slots` (saved before this, today) opens with none: a default inside the same version, not a migration (bowen may already have files; dot to confirm).
4. **Tests:** a slider drag previews without writing and commits one step, Esc writes nothing; a canvas drag in move mode moves only the picture, one step, and each cancel path writes nothing (late pointerup included); arrow keys nudge the active picture, not the selection, and not while a field is focused; slots save, recall, rename, clear, undo, survive a file, refuse bad slots; a version-5 file without slots opens.

### 8a. Boundaries added (dot 1791703489); no round-two code until round one passes

**Round two coded** (plan accepted by dot 1791703574): core `slots` in `src/reference`; bench live preview, Move picture, slots panel; tests `test/reference.test.ts` (slots), `bench/test/reference-move.test.tsx`. Not observable today: Move picture's ownership of the arrow keys when no picture is active (interaction handles no arrow keys at all); the guard stays for when it does.

1. **A preview ends once.** Enter commits and ends it, so a later blur commits nothing; Esc or any cancel ends it, so a late blur or pointerup commits nothing. Only a text that parses to a finite number in the field's range reaches core: "", "-" and other invalid text change nothing. A preview whose picture was undone, removed or changed elsewhere since it started (a different drawing, source or value underneath) is dropped, never written back.
2. **Move picture owns its inputs while on.** Arrow keys never reach lines or the selection while it is on, even with no valid active picture (they then do nothing). During a drag or a slider preview the arrow keys are ignored. Turning the toggle off cancels a drag first.
3. **Active picture and preview are bound** to the drawing, the view, the picture (id and source) and the App's cancel counter (§7.1). Opening another drawing whose picture has the same id does not inherit the old active target or preview.
4. **Slots in the file:** a missing `slots` opens as an empty list (an optional field of version 5; today's files stay valid, dot 1791703489). A `slots` that is present but `null`, an object, or holds a bad slot is refused. Slots are deep-copied on the way in and on reading, so outside changes cannot reach the stored state or the undo history. A slot's scale is checked like the picture's: `width · scale` and `height · scale` finite.

## 9. Mirror a picture left-right (bowen 1791716942) — rules before code

**Coded** (for dot's check; direction OK dot 1791717133, bowen's choice relayed there: the picture mirror first, line mirroring across views not now): `src/reference/index.ts` (`flipped`), the bench's **Mirror ⇆** and drawing. Tests `test/reference.test.ts` (2 new), `bench/test/reference-move.test.tsx` §9 (8). Checked in Chrome: a lopsided "F →" tilted 30° mirrors to a reversed F with the arrow pointing left, tilted the other way, angle −30.

**Boundaries added** (dot 1791717133): the drawing is an explicit composition — the picture's own left-right mirror about its centre first, then the rotation about the centre (written `rotate(a, c) · translate(c) · scale(−1, 1) · translate(−c)`, since SVG applies a transform list right to left to a point); tested on a lopsided picture tilted 30°: every mark's x is reflected about the centre, its y kept — not only the negated angle. Data (dot 1791717144): missing at open or placing is `false`; `setReference` without it keeps the value; given, it must be true or false (an explicit `undefined` included). A slot saved, then Mirror, then recalled: the placement comes back and the mirror stays. `flipped` is part of the preview's base (`sameBase`): a preview whose picture was mirrored underneath is dropped. The button is bound to the drawing, the counter and the picture (id and source) it was drawn for; if they no longer hold — another drawing opened, here or by another App, even with a picture of the same id — the whole action is dropped, nothing cancelled or written (dot 1791717696). Mirror ⇆ during a picture drag cancels that drag by the gesture's one cancel path — its window listeners and ghost go, a later move draws nothing and the late release writes nothing (dot 1791717672). Mirror ⇆ during a panel preview ends that preview first by its one ending (written if unchanged underneath), then reads the document and mirrors; a late blur or pointerup of the preview writes nothing.

**Why:** bowen draws the 90 view over the −90 picture mirrored, instead of mirroring lines into 90 ("这样我就能不需要镜像给90，0画线了"). In the reference package, nowhere else.

- **Data:** each picture gets `flipped: boolean` — drawn mirrored left-right in its own frame, before its rotation. In the file (version 5) it is optional: missing means `false`; present must be `true` or `false`, anything else is refused at open and at `setReference`. It is one of the properties `setReference` changes (`ReferenceProps`), so it is in the one draft, undo and file like `x` or `opacity`. Slots keep their placement as now (`x`, `y`, `scale`, `angle`, as v2): mirroring is not a placement.
- **Panel:** one button per picture, **Mirror ⇆**. It mirrors what is seen about the vertical line through the picture's centre, as a mature editor's "Flip Horizontal" does: one `setReference` with `flipped` toggled and `angle` negated (a tilted picture's tilt reverses with it; the centre stays). One undo step; pressing it twice gives back exactly the picture before. Like every reference edit it is a panel edit that never settles, and is disabled where the panel is (playback, restoring).
- **Canvas:** drawn as `rotate(angle, centre)` then a left-right mirror about the centre. Picking it for Move picture uses the same formula with the picture's current angle: after a mirror a tilted picture covers a different area (its angle is negated), so a point inside only the old rectangle misses and one inside only the new rectangle hits (dot 1791717144).
- **Not now:** mirroring top-bottom; copying a picture into the opposite view (bowen places the file again in the 90 view).
- **Tests:** core — `setReference({ flipped })` and undo; open without `flipped` → `false`; a non-boolean refused at open and at `setReference`; save → open keeps it; slots unchanged. Bench — Mirror ⇆ draws the picture mirrored with the angle negated, twice gives the original exactly, one undo step, disabled in playback; feature-off: without the button's write, or without the mirror in the drawing, the tests fail. Checked once in Chrome.

## 10. Picture library: one stored copy per picture (bowen 1791725516) — rules before code

**Why:** bowen's file `111.json` is 20 MB for 8 lines: one 2.2 MB reference sheet placed in all nine views is stored nine times (each `images[k].src`). He asks for a library: pictures added once, referenced by the views, the file not copying them.

**File version — waiting for bowen** (dot 1791725751, 1791725788). Staying at version 5 is withdrawn: a structure an older program cannot read is not an optional field like `slots` or `flipped`. Proposed by dot, for bowen to confirm: the library format is **version 6**, and **version 5 only** is converted once, as a stated exception to the "no migration" rule (`docs/archive-plan.md`); versions 1–4 stay refused.
- **The conversion** (version 5 → 6): each inline `src` moves into the library (identical `src` → one entry, named by the first image's id, with that image's size as the default), each image then names it by `asset` and keeps its own `width` and `height`; lines, groups, names, the nine views' shapes, every picture's view, placement, opacity, visibility, `flipped` and slots are unchanged. Nothing else in the file changes. A version-5 file that fails today's checks still fails.
- **The original is kept:** opening a version-5 file never writes over it; the first save writes version 6 (a new file from the bench's Save; the autosave record is replaced only after the converted drawing is open, as with any restore).
- **Autosave:** restoring a version-5 record goes through the same conversion and is restored as the drawing, never backed up as unreadable and never replaced by an empty one.
- Until bowen answers, the conversion and the version number are not coded; the library rules below are refined meanwhile.

- **Data:** `reference.library: [{ id, name, src, width, height }]` — the picture's content once (`src` checked as now: type, full base64, signature, size); its `width`, `height` are only the default size for a new placement. An image keeps its own `view`, **`width`, `height`** (the size it is drawn at, as today), `x`, `y`, `scale`, `angle`, `opacity`, `visible`, `flipped`, `slots`, and names its content by `asset`. Reading an image (`references()`) gives its own `width`, `height`, the `src` of its library entry, and `asset`, so drawing and picking do not change. The library shares content, never a placement's size (dot 1791725852): a file may hold one `src` with different `width` / `height` per image, and each keeps its own.
- **One copy per picture:** placing a picture whose `src` is identical (same text) to a library entry uses that entry; no second copy. In a version-6 file every image names its picture by `asset`; an inline `src`, an `asset` naming no library entry, a library entry failing the checks, two entries with the same id or the same `src`: the file is refused (`open-failed: reference: …`).
- **Edits** (all in the one draft, undo and file, never settling, like the other reference edits): `addAsset({ name, src, width, height }) → id` (an identical `src` returns the existing id, nothing added); `renameAsset(id, name)`; `removeAsset(id)` — refused while any image uses it (`reference-asset-in-use`); `placeReference` takes either `asset` or `src` (a `src` goes through `addAsset` first). Removing an image never removes its library entry.
- **Bench:** a **Library** list under Reference: each picture with a small thumbnail and its name (renamed by double-click, `rename/`), **放到当前视角** (place into the view shown, centred, scale 1), and **×** (disabled while used, with the count of views using it). **＋ 加图片** adds a file to the library without placing it. The existing **Place…** adds the file to the library (or reuses an identical one) and places it, as now.
- **Ledger row 16 is hit** (a change to the reference panel's controls): in the same package, Remove, the visibility checkbox and the slot buttons are bound like Mirror ⇆ — `{ core, gen, id, src }` at render, the action dropped if `refNow` no longer finds that picture, a running gesture cancelled, a panel preview ended — and row 16 closes with it. The new library controls follow the same three checks (bound to `{ core, gen, asset id, src }`).
- **Not now:** pictures shared live between views (moving one moves all) — each view keeps its own placement; deleting unused library entries automatically.
- **Tests:** core — place twice with the same `src` → one library entry; convert a version-5 file where two images share one `src` with different `width` / `height` → one entry, each image drawn at its own size exactly as before (dot 1791725852); convert a version-5 file with nine identical inline pictures → one entry, every image's placement, `flipped` and slots unchanged, the drawing's text outside `reference` unchanged, saved size about one picture; a bad version-5 file still refused; version 4 refused; autosave restoring a version-5 record restores it converted (not backed up, not empty); `asset` unknown / duplicate entries / bad picture refused at open; `removeAsset` in use refused, unused removed, undo restores; `addAsset` identical returns the same id; save → open keeps library and images. Bench — Library list shows one entry for bowen's file; 放到当前视角 places it; ＋ 加图片 adds without placing; × disabled while used; the three bound controls (Remove, visibility, slots) with a stale binding change nothing (two-App regression as for Mirror); feature-off checks. Real check: bowen's `111.json` opened and saved → about 2.3 MB, all nine views drawn as before (compared by screenshot).
