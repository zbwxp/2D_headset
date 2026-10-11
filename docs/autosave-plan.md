# Autosave — rules before code

**Status:** first draft for dot's check (asked by bowen 1791703721, "自动保存你做一下吧", and 1791703731, "单独package就行 未来要重构的"; priority and boundaries by dot 1791703953).

**Why:** a refresh of the bench loses everything not saved by hand (bowen 1791703292). With hot updates off (`9e408c9`, verified by dot 1791703953) new code arrives only on a refresh, so a refresh must not lose work.

## 1. What it is

- A separate package, **`autosave/`** (beside `interaction/` and `visual/`), used only by the bench. It knows nothing of core's rules: it stores and returns the text that `save(core)` produces, and the bench calls `open` on it.
- **Store:** the browser's IndexedDB (no size limit that reference pictures would hit, unlike localStorage). One record, `current`: `{ text, savedAt }`. The storage is behind a small interface (`get`, `put`, `remove`), so the logic is tested with an in-memory store; the IndexedDB adapter is thin.

## 2. Restore first, then save (dot 1791703953)

- On start the bench **restores before anything can be saved**: it reads `current`; if there is one and `open` accepts it, that drawing replaces the empty one (as an Open does: interaction told, the App's counter advanced). Until the read has finished, no autosave write happens, so an empty drawing can never overwrite an existing save.
- **A stored drawing that does not open** (damaged, or an older file version) is never overwritten silently: it is first copied to a backup record `unreadable-<time>`, the status line says so, and only then does autosave start on the new drawing.
- Restoring is not an edit and not an undo step; the undo history starts empty, as after an Open.

## 3. Saving in order (dot 1791703953)

- After every published change (edit, undo, redo, Open, a placed picture) the bench gives autosave the current `save(core)` text. Autosave writes it if it differs from the last written text.
- **In order:** one write at a time. A newer text arriving while a write is running waits; if several arrive, only the newest is written next. A later state is never overwritten by an earlier one.
- **A failed write is shown** in the status line (`✗ autosave failed: …`, e.g. the browser's storage full or blocked) and kept on screen until a later write succeeds. The drawing itself is untouched; manual **Save** stays as it is.
- Playback writes nothing (it changes nothing).

## 4. Not in scope

- Several tabs or windows on one bench: each autosaves its own drawing to the same record, so the last one written wins. Stated in the panel's hint; not solved now.
- Version history or multiple named drawings: later, when it is refactored (bowen 1791703731).

## 5. Tests (in-memory store; the IndexedDB adapter is not run in jsdom)

- **Restore:** a stored drawing is opened on start; nothing is written before the read finishes, even if the App draws first; an unreadable stored drawing is backed up before the first write.
- **Order:** three changes in quick succession with a slow store → the store ends with the last one; never an earlier one after a later.
- **Failure:** a store whose `put` fails → the status shows the error, the drawing is unchanged, the next successful write clears it.
- **No write for no change:** the same text twice writes once.
