# Masks (蒙版) — package 2: the relations in the drawing, and a first way to make them (checklist before any code, for dot's review)

Package 1 (geometry and drawing, accepted by dot 1791903553 at 29baaf3) drew masks from a temporary bench store. Package 2 stores them in the drawing (graph "显隐 — masks", preliminary, headset-design a7bb159: 甲) and gives bowen a first way to make and remove them (proposed to bowen 1791903501, so that he can try 126.json on 5190). Picking that follows the drawing stays for package 3.

## 1. A core module `masks` (data only; the computing stays in `visibility/`)
- A relation: `{ id, sources: fill ids (≥ 1, no repeats), target: { kind: 'line' | 'fill', id }, mode: 'inverse' | 'normal' }`. Shared by every view (each view computes with its own geometry). A list in creation order; the order means nothing (each relation only removes).
- **Editor operations** (one edit each, undoable): `mask(id, sources, target, mode)` — refused for an unknown fill or target, a source that is the target fill itself, a repeated source, or an id in use; `removeMask(id)`. Declared in `src/document/effects.ts` (writes the shared `masks`; no geometry). **Locks are not consulted** (bowen 1791903940: editing is limited to the selected layers; locks to be removed later — ledger row 21): a locked target or source takes and loses masks like any other.
- **The snapshot** lists the relations (`masks`), for the bench.

## 2. Reference upkeep (dot 1791901344: designed, not assumed) — each by the same path as fills' and joins'
- **A target line split** (`replaced`): the relation is kept on **both** pieces — one relation per piece (the first keeps the id, the second a new relation `id/<piece>`, made unique if that is taken). A fill keeps its id through a split (fills.update), so relations whose sources or target are fills stay as they are (dot 1791903786).
- **A target line or fill gone** (deleted, collapsed, a fill whose loop broke or was cleared): the relation is removed.
- **A source fill gone:** dropped from the relation's sources; a relation left with no source is removed.
- **A fill switched off** (hidden): the relation stays, only paused (package 1's "on"); only a fill that is gone (cleared, its loop broken, deleted) clears references. The fills are brought up to date first, then the masks (dot 1791903786).
- **Copy / paste, copy layer:** a relation goes with the clip when its target **and all its sources** are in the clip (a fill is in the clip when all its lines are, as today); new ids as the clip's other records. Otherwise it stays behind. The fills are pasted first and give their **old → new fill ids**; the masks are attached with that map and the lines' map (dot 1791903786). A clip's masks are checked like its other parts (every reference inside the clip), a bad one refuses the paste; a clip without masks (older) pastes with none.
- **Move a curve to another layer, rename:** ids are kept; nothing to do.
- **Undo / redo:** the whole state, as every module.
- **Mirror link / apply:** not carried to the mirrored side (recorded).

## 3. The archive
- `VERSION` 9 → 10: the drawing holds `masks`; `legacy.upgrade` turns a v9 file into v10 with no masks, the existing 5 → … → 9 chain feeding into it (src/legacy, deletable for a release, bowen 1791820592). Opening checks every reference (fill ids exist and are filled, the target exists, modes valid, ids unique) when the masks are read, before any settle — a bad file is refused, not repaired or quietly cleaned (dot 1791903786).

- **The autosave record is never rewritten without its original (dot 1791906394):** the 9 → 10 conversion is not yet approved by bowen, and the bench saves the drawing to its own record. When a stored record opens but not as stored (an older format, converted on opening), autosave first keeps the original as `before-upgrade-<time>` (as it keeps an unreadable one), then writes; if that backup fails, autosave stays off. Files on disk are never written by opening them. **Until bowen approves 9 → 10** (asked 1791906737), a version-9 record is not replaced at all: autosave goes off with the reason (「旧格式画稿……请用 Save 下载」) and the record stays as stored (dot 1791906782); the bench's hold is removed once he approves.

## 4. The bench (replaces package 1's temporary store)
- The drawing's own masks are drawn, behind the same 「蒙版（实验）」 switch (still needs 墨迹轮廓).
- **Making one (minimal; bowen 1791903762 "按成熟的蒙版构建逻辑来", dot 1791905577):** the mature order (Illustrator's opacity mask, Photoshop's layer mask): the target first, then the mask area, then the mode. In the properties panel a 「蒙版」 section for the subject:
  - **The targets:** a line → that line; a continuous curve → its lines (and its filled loops with 「填充也遮」 ticked); a layer → all its lines (and its filled loops with 「填充也遮」) — as Illustrator masks a whole group: one relation per target, all made in one edit, so 126.json is two adds, not ten. Fills are opt-in because two layers masking each other with their fills too leave the overlap empty (126.json through the panel, 2026-10-13; shown to bowen).
  - **The list:** the masks on those targets, each as 目标 ← 来源（图层 · 曲线）· 反向/正常, with × (one edit each).
  - **新建:** the drawing's filled loops to tick as sources, each labelled by its layer and curve with its colour; the targets' own fills are not offered (a fill never masks itself); 反向 / 正常; 添加 (disabled with no source ticked). One edit, one undo step.
  - Shown only where it can be used (the panel edits: `run` given).
- `window.bench.setMasks` goes.
- **The panel's draft** (ticked sources, mode) belongs to one drawing and one target: another subject, another drawing, or the target gone drops it — never added to an old target (dot 1791903786).
- No 停用 switch for now (dot 1791905577).

## 5. Evidence
- Core tests: make / remove / refusals; split of a target → both pieces masked; deleting a target, a source fill, clearing a fill, breaking a loop; copy-paste with and without the sources; copy layer; archive v10 round trip, v9 opens with no masks, bad references refused.
- Bench: making the 126.json masks through the panel on 5190-like bench (two relations per line set) gives package 1's picture; × removes; undo.
- A rendered PNG of 126.json made through the panel.

## 6. Not in package 2
Picking that follows the drawing (package 3); lines' stroke areas as sources; stroke intervals; mirror.
