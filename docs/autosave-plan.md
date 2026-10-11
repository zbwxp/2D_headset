# Autosave — rules before code

**Status:** for dot's check, with every point of dot 1791703953, 1791704170 and 1791704242 merged (asked by bowen 1791703721, "自动保存你做一下吧", and 1791703731, "单独package就行 未来要重构的").

**Why:** a refresh of the bench loses everything not saved by hand (bowen 1791703292). With hot updates off (`9e408c9`, verified by dot 1791703953) new code arrives only on a refresh, so a refresh must not lose work.

## 1. What it is

- A separate package, **`autosave/`** (beside `interaction/` and `visual/`), used only by the bench. It knows nothing of core's rules: it stores and returns the text that `save(core)` produces, and the bench calls `open` on it.
- **Store:** the browser's IndexedDB (a much larger quota than localStorage, which reference pictures would exceed; it still has a quota and a write can still fail, §3; dot 1791704170). One record, `current`: `{ text, savedAt }`. The storage is behind a small interface (`get`, `put`, `remove`), so the logic is tested with an in-memory store; the IndexedDB adapter is thin.

## 2. Restore first, then save (dot 1791703953)

- On start the bench **restores before anything can change**: until the read has finished, editing and Open are disabled and no autosave write happens (dot 1791704170). The gate is the App's own write entry, not only the panels: the editing panels, the canvas press, Open, the keyboard shortcuts (tools, ⌘Z / ⇧⌘Z, ⌘C / ⌘X / ⌘V, Delete) and the App's logged Core (every edit, undo and redo through it is refused while restoring, as in playback) (dot 1791704242).
- **Unmounting:** a restore that returns after its App unmounted changes nothing; an unmounted App takes no new saves. An App mounted on the same page while an earlier App's write is still running starts its own queue only after that write ends, so one page never has two queues writing at once (dot 1791704242). So a late restore cannot overwrite something the user just drew or opened, and an empty drawing can never overwrite an existing save. When the read returns: if there is a record and `open` accepts it, that drawing replaces the empty one (as an Open does: interaction told, the App's counter advanced); then editing is enabled.
- **A stored drawing that does not open** (damaged, or an older file version) is never overwritten silently: it is first copied to a backup record `unreadable-<time>`, the status line says so, and only then does autosave start on the new drawing.
- **If the read itself fails, or the backup write fails,** the store is not treated as empty: autosave stays off for this page (the status line says so, with the error), editing works, manual Save works, and nothing is written to the store.
- Restoring is not an edit and not an undo step; the undo history starts empty, as after an Open.

## 3. Saving in order (dot 1791703953)

- After every published change (edit, undo, redo, Open, a placed picture) the bench gives autosave the current `save(core)` text: the **wanted** text.
- **In order:** one write at a time. A wanted text arriving while a write runs waits; if several arrive, only the newest is kept. **After every write ends, the newest wanted text is compared again with what is on disk**, and written if it differs. So with A on disk, B being written and an undo back to A, A is written after B: it is not skipped because "A equals the last saved value" (dot 1791704242).
- **"Saved" means the IndexedDB transaction completed** (`complete`), not that the `put` request succeeded; a transaction that aborts after a successful request is a failure (dot 1791704242). Only a completed transaction updates the on-disk baseline.
- **Status:** "saved" when the newest wanted text is on disk; "saving…" while a write runs or a newer text waits; "✗ not saved: …" when the last write failed (e.g. the storage full or blocked). A failure leaves the on-disk baseline as it was and keeps the newest wanted text, which the next change or the next write retries. The drawing itself is untouched; manual **Save** stays.
- **What a refresh keeps:** the last completed save, nothing more. While the newest text is not yet saved, leaving or refreshing the page asks for confirmation (the browser's leave-page prompt), and manual Save stays (dot 1791704242).
- **Playback:** a correction made by dragging in playback is a real edit and is saved like any other; only moving the angle sliders changes nothing and writes nothing (dot 1791704170).

## 4. Not in scope

- Several tabs or windows on one bench: each autosaves its own drawing to the same record, so the last one written wins. Stated in the panel's hint; not solved now.
- Version history or multiple named drawings: later, when it is refactored (bowen 1791703731).

## 5. Tests (in-memory store; the IndexedDB adapter is not run in jsdom)

- **Restore:** a stored drawing is opened on start; editing and Open are disabled until the read finishes (a press or an Open attempted meanwhile does nothing); an unreadable stored drawing is backed up before the first write; a failed read or a failed backup leaves autosave off and the store untouched.
- **Playback:** a correction in playback is saved; moving the sliders alone writes nothing.
- **Order:** three changes in quick succession with a slow store → the store ends with the last one; **A on disk, B being written, undo back to A → the store ends with A** (dot 1791704242).
- **Failure:** a store whose write fails → "not saved", the drawing unchanged, the baseline not updated, the newest text kept and retried; **a request that succeeds but whose transaction aborts** counts as a failure (dot 1791704242).
- **Gate:** while restoring, the shortcuts (a tool key, ⌘Z) and an edit through the App's logged Core change nothing; a restore returning after unmount changes nothing; an App mounted during a running write starts writing only after it ends.
- **Status and leaving:** "saving…" while queued, "saved" after the transaction completes; the leave-page prompt is armed only while unsaved.
- **No write for no change:** the same text twice writes once.
