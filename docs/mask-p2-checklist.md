# Masks (蒙版) — package 2: the relations in the drawing, and a first way to make them (checklist before any code, for dot's review)

Package 1 (geometry and drawing, accepted by dot 1791903553 at 29baaf3) drew masks from a temporary bench store. Package 2 stores them in the drawing (graph "显隐 — masks", preliminary, headset-design a7bb159: 甲) and gives bowen a first way to make and remove them (proposed to bowen 1791903501, so that he can try 126.json on 5190). Picking that follows the drawing stays for package 3.

## 1. A core module `masks` (data only; the computing stays in `visibility/`)
- A relation: `{ id, sources: fill ids (≥ 1, no repeats), target: { kind: 'line' | 'fill', id }, mode: 'inverse' | 'normal' }`. Shared by every view (each view computes with its own geometry). A list in creation order; the order means nothing (each relation only removes).
- **Editor operations** (one edit each, undoable): `mask(id, sources, target, mode)` — refused for an unknown fill or target, a source that is the target fill itself, a repeated source, or an id in use; `removeMask(id)`. Declared in `src/document/effects.ts` (writes the shared `masks`; no geometry). A locked target or source: allowed — a mask adds no geometry change (recorded).
- **The snapshot** lists the relations (`masks`), for the bench.

## 2. Reference upkeep (dot 1791901344: designed, not assumed) — each by the same path as fills' and joins'
- **A target line split** (`replaced`): the relation is kept on **both** pieces — one relation per piece (the first keeps the id, the second `id′`).
- **A target line or fill gone** (deleted, collapsed, a fill whose loop broke or was cleared): the relation is removed.
- **A source fill gone:** dropped from the relation's sources; a relation left with no source is removed.
- **Copy / paste, copy layer:** a relation goes with the clip when its target **and all its sources** are in the clip (a fill is in the clip when all its lines are, as today); new ids as the clip's other records. Otherwise it stays behind.
- **Move a curve to another layer, rename:** ids are kept; nothing to do.
- **Undo / redo:** the whole state, as every module.
- **Mirror link / apply:** not carried to the mirrored side (recorded).

## 3. The archive
- `VERSION` 9 → 10: the drawing holds `masks`; `legacy.upgrade` turns a v9 file into v10 with no masks (src/legacy, deletable for a release, bowen 1791820592). Opening checks every reference (fill ids exist and are filled, the target exists, modes valid, ids unique) — a bad file is refused, not repaired.

## 4. The bench (replaces package 1's temporary store)
- The drawing's own masks are drawn, behind the same 「蒙版（实验）」 switch (still needs 墨迹轮廓).
- **Making one (minimal):** in the properties panel, when the subject is one line or one fill, a 「蒙版」 section: its masks listed (sources by their curve's name, the mode), each with ×; 「新建蒙版」 = a list of the drawing's filled loops (by their curve's name and layer) to tick as sources, 反向 / 正常, 添加. One edit each; undoable.
- `window.bench.setMasks` goes.

## 5. Evidence
- Core tests: make / remove / refusals; split of a target → both pieces masked; deleting a target, a source fill, clearing a fill, breaking a loop; copy-paste with and without the sources; copy layer; archive v10 round trip, v9 opens with no masks, bad references refused.
- Bench: making the 126.json masks through the panel on 5190-like bench (two relations per line set) gives package 1's picture; × removes; undo.
- A rendered PNG of 126.json made through the panel.

## 6. Not in package 2
Picking that follows the drawing (package 3); lines' stroke areas as sources; stroke intervals; mirror.
