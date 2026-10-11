# Autosave — rules before code

**Status:** first draft for dot's check (asked by bowen 1791703721, "自动保存你做一下吧", and 1791703731, "单独package就行 未来要重构的"; priority and boundaries by dot 1791703953).

**Why:** a refresh of the bench loses everything not saved by hand (bowen 1791703292). With hot updates off (`9e408c9`, verified by dot 1791703953) new code arrives only on a refresh, so a refresh must not lose work.

## 1. What it is

- A separate package, **`autosave/`** (beside `interaction/` and `visual/`), used only by the bench. It knows nothing of core's rules: it stores and returns the text that `save(core)` produces, and the bench calls `open` on it.
- **Store:** the browser's IndexedDB (a much larger quota than localStorage, which reference pictures would exceed; it still has a quota and a write can still fail, §3; dot 1791704170). One record, `current`: `{ text, savedAt }`. The storage is behind a small interface (`get`, `put`, `remove`), so the logic is tested with an in-memory store; the IndexedDB adapter is thin.

## 2. Restore first, then save (dot 1791703953)

- On start the bench **restores before anything can change**: until the read has finished, editing and Open are disabled (the editing panels, the canvas press and Open, as in playback) and no autosave write happens (dot 1791704170). So a late restore cannot overwrite something the user just drew or opened, and an empty drawing can never overwrite an existing save. When the read returns: if there is a record and `open` accepts it, that drawing replaces the empty one (as an Open does: interaction told, the App's counter advanced); then editing is enabled.
- **A stored drawing that does not open** (damaged, or an older file version) is never overwritten silently: it is first copied to a backup record `unreadable-<time>`, the status line says so, and only then does autosave start on the new drawing.
- **If the read itself fails, or the backup write fails,** the store is not treated as empty: autosave stays off for this page (the status line says so, with the error), editing works, manual Save works, and nothing is written to the store.
- Restoring is not an edit and not an undo step; the undo history starts empty, as after an Open.

## 3. Saving in order (dot 1791703953)

- After every published change (edit, undo, redo, Open, a placed picture) the bench gives autosave the current `save(core)` text. Autosave writes it if it differs from the last written text.
- **In order:** one write at a time. A newer text arriving while a write is running waits; if several arrive, only the newest is written next. A later state is never overwritten by an earlier one.
- **A failed write is shown** in the status line (`✗ autosave failed: …`, e.g. the browser's storage full or blocked) and kept on screen until a later write succeeds. The drawing itself is untouched; manual **Save** stays as it is.
- **Playback:** a correction made by dragging in playback is a real edit and is saved like any other; only moving the angle sliders changes nothing and writes nothing (dot 1791704170).

## 4. Not in scope

- Several tabs or windows on one bench: each autosaves its own drawing to the same record, so the last one written wins. Stated in the panel's hint; not solved now.
- Version history or multiple named drawings: later, when it is refactored (bowen 1791703731).

## 5. Tests (in-memory store; the IndexedDB adapter is not run in jsdom)

- **Restore:** a stored drawing is opened on start; editing and Open are disabled until the read finishes (a press or an Open attempted meanwhile does nothing); an unreadable stored drawing is backed up before the first write; a failed read or a failed backup leaves autosave off and the store untouched.
- **Playback:** a correction in playback is saved; moving the sliders alone writes nothing.
- **Order:** three changes in quick succession with a slow store → the store ends with the last one; never an earlier one after a later.
- **Failure:** a store whose `put` fails → the status shows the error, the drawing is unchanged, the next successful write clears it.
- **No write for no change:** the same text twice writes once.
