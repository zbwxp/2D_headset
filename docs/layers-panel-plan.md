# Layers panel (visual UI): plan, written after the code

dot 1791550540 asked for this plan before the change. The panel was built first, at `a0e56e2`; this note states its boundaries so they can be reviewed against the code.

## What it is

The Adobe-style layers area on the right (bowen 1791550416, 1791550512). It holds:
- one row per layer: eye, lock, twirl, thumbnail, name, mirror tag, line count;
- curve rows when a layer is expanded: eye, lock, thumbnail, name;
- drag to reorder;
- bottom buttons: fills on / off for the current layer, new, copy, delete.

## Boundaries

- **Place:** `bench/src/ui/LayersPanel.tsx`.
  - It is visual UI only; there are no visual principles yet, so there is no theme framework.
  - It imports types only from core's package root, and nothing imports it except the bench's `main.tsx`.
- **Reads:** the snapshot and geometry it is given.
  - Eye and lock show the layer's or curve's lines: shown unless all are hidden, locked when all are locked.
  - The mirror tag shows when any line is in a mirror pair.
  - Thumbnails draw the geometry inside the frame of the whole drawing.
- **Writes:** only through `run`, the bench's one-shot core call followed by `ix.historyChanged()` (doc 22 §3.5). The calls are:
  - `layerState` (eye, lock);
  - `groupState` (curve eye, lock);
  - `selectGroup` (click a curve);
  - `renameLayer`, `reorderLayer`;
  - `layer` (new, above the current one);
  - `copyLayer`, `deleteLayer`, `layerFills`.

  What each call means is core's, unchanged. Refusals show in the bench's status line.
- **Its own state is visual only:** which layers are expanded, which name is being edited, which row is being dragged.
  - The current layer is the bench's (`layer`, passed in); the panel only sets it.
  - The panel keeps no second copy of layers, selection or locks.

## Checked in the browser

- show / hide (a mirror-linked layer hides its pairs too, by the existing paired rule);
- lock;
- expand;
- new layer;
- rename by Enter, and a taken name refused in the status line;
- drag to reorder.
