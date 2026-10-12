# J1b — the join list in the bench: checklist before any code (for dot's review)

J1 (778e955, accepted by dot 1791812679) put the joins in the core: 'bound', the per-point list (order = precedence), the per-view zone. J1b lets bowen see and change them: the panel and the Join tool. Principle: docs/ink-joins-principle.md §2.2, §2.5, §4. No ink change (J2).

## 1. The zone's length as a read (core, `derived`)
- The panel shows a join's desired length and the length actually used after the short-line limit (dot 1791809701). The visual package may only import core types (visual/test/boundary.test.ts), and J2's ink needs the same numbers, so they come from the view's geometry: `Geometry.zones: { point, lines, desired, used, manual }[]` (src/derived/index.ts), one per join, in the view read:
  - `desired` = the manual zone of this view, else `autoZone(w0, w1)` = wider² / narrower from this view's widths (src/joins `autoZone`, J1);
  - `used` — the principle's limit (§4): between two lines, 2 · min(desired / 2, L0 / 3, L1 / 3), L = the lines' drawn lengths in this view; at an arc of length A, desired ≤ A → desired, else A + 2 · min((desired − A) / 2, L0 / 3, L1 / 3);
  - `manual` — whether this view holds a manual value.
- This extends the existing `geometry()` read with a field; no new read entry (ledger row 6 concerns new read entries — for dot to judge).

## 2. The panel (visual/PropertiesPanel.tsx)
- **A line** (the subject, as today): each end — an open end as today (end stroke); a shared point shows **the point's join list, top first**, each row "曲线A ↔ 曲线B" by line names (dot 1791809701), the row(s) containing this line marked, the topmost of them marked 「管这一端」 (§2.3). Lines at the point with no join to this line are listed as 「相接、无接法」.
- **Each join row:** the mode (仅绑定 / 平滑 / 尖角 / 圆弧) — a change is `join(point, l1, l2, { mode, radius })`, an arc taking the Join tool's radius when it had none; an arc's radius (this view); the zone — 自动 / 手动 with the length, a manual value set by `zone(point, l1, l2, length)` and 自动 by `zone(…, null)`; the desired and the used length (§1).
- **Reorder by dragging** a row within its point's list (bowen 1791810865): the drop calls `joinOrder(point, pairs)`; one edit, undoable.
- **A point** as subject — a selected end point shows the same list for that point.
- Every change goes through the panel's `run` (the bench's edit in the current view); the panel stays presentational (types from core only).

## 3. Which subject the panel shows
- Today the subject is the last row clicked in the layers list (visual/LayersPanel.tsx:49). Added: when the canvas selection is exactly one line or exactly one point, the panel shows it; a list click still sets it. (bench passes the canvas subject to LayersPanel.)

## 4. The Join tool
- 'bound' offered beside smooth / cusp / arc (interaction/base.ts:11 `Options.joinMode`, the bench's select). Clicking two lines with 'bound' sets their pair to 'bound' (on top of the point's list when new).

## 5. Flows to run (bench tests; then the real drawing on 5199 with screenshots)
1. Select a line in a chain: each end lists its point's join ('仅绑定', 管这一端), desired 1 / used for default widths.
2. Change a row's mode to 平滑 / 圆弧 (radius from the tool) / back to 仅绑定; the list order stays.
3. Zone: 手动 12 in this view → used = min with the limit; another view still 自动; 自动 clears it; a mode change keeps it.
4. A fork: three lines at a point, two joins; drag the lower row above → order changes in every view; the governing mark moves; undo restores.
5. Select a point (A on an end point) → the point's list.
6. The Join tool with 仅绑定 on two lines meeting at a fork → a new row on top.
7. Width change → automatic desired / used update.

Tests: ordinary cases and operations only; ledger rows 18 / 19 unchanged (the panel reorders one point).
