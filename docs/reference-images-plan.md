# Reference images — rules before code

**Status:** first draft for dot's check. No code until dot accepts it.

**Asked by bowen** 1791700171, 1791700193 (v2's background reference images, in the new version, a separate module, no editing), 1791701099 ("独立package做差不多能用就行 之后可以再优化": roughly usable first, optimise later). **v2 for reference:** `4bc7cc2`, `proto/base` (`schema.ts` `ImageRecord`, `imageCommands.ts`, `imageData.ts`, `ui/imagePanel.tsx`, `view/images.ts`).

**Defaults, not decided by bowen** (asked 1791700309; he can change them): one image belongs to **one view**, shown only there; **not shown in playback**.

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
- `x`, `y`, `angle`: finite; `scale`: finite and > 0; `opacity`: 0–1; `visible`: boolean; `view`: one of the nine — `reference-bad-value`.
- `id`: a new id for `place` (`reference-exists`), an existing one for `set` / `remove` (`reference-unknown`).
- The same checks at open (a file with a bad image is refused, `open-failed`).
- The bench decodes the picture before placing (the browser's own decoder: an image that does not decode is refused there, with a status message); core does not decode.

## 4. The bench

- A **Reference** panel, in the editing fieldset (disabled in playback, and the playback gate refuses every non-`correct` call anyway): **Place…** (file input, PNG / JPEG / WebP), then, for each image of the current view: opacity, x, y, scale, angle, visible, remove.
- **Placing:** the file is read and decoded asynchronously. The read binds the drawing (`core` and its saved text) and the view at its start; if either changed when it returns, it is dropped with a log row, nothing written. Initial placement as v2: native size, centred in the view's box, shrunk to fit 90% if larger; opacity 0.5.
- **Drawn** as an SVG `<image>` before the fills and lines, only in its view, never in playback.

## 5. Tests

- **Core:** each refusal (bad type, wrong signature, too wide, bad numbers, unknown view, duplicate / unknown id); place, set and remove are one undo step each; an edit of reference operations commits in `keeps` mode, with every point, line and the other parts byte-identical, and two coincident points of one layer (opened from a file) staying two; a file round-trips its images; a file with a bad image does not open; a clip carries no images; `references(view)` returns only that view's images.
- **Bench:** placing shows the image in its view and not in another or in playback; a read that returns after a view change, or after another drawing was opened, writes nothing; in playback the panel and the gate write nothing.

## 6. Not now

Dragging on the canvas, masks, position slots, the colour picker, images in playback, images shared by all views (all possible later, bowen 1791701099).
