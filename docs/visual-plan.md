# Visual package: plan (before the move)

dot 1791550564 and bowen 1791550635: give visual UI its own package boundary now, keep its insides simple, and don't wait to split it later.

## Boundary

- **Place:** `headset-core/visual/`, beside `src/` (core) and `interaction/`. The entry is `visual/index.ts`.
- **What it holds:** layout, panel items, buttons, icons and styles. For now that is the layers panel, moved from `bench/src/ui/LayersPanel.tsx`.
- **What it imports:**
  - types only from core's package root (`../src`);
  - React.
  - Never `interaction/`, never core's modules directly.
- **Who imports it:** only the app (the bench). Core and interaction never import it.
- **Reads and writes** (unchanged from `docs/layers-panel-plan.md`):
  - it reads the data it is given;
  - every change is a callback the app provides (`run`), which calls core's public operations;
  - its own state is visual only;
  - it keeps no second copy of layers, selection or locks.
- **No theme framework yet.** Visual principles come later.

## Checks

- A boundary test in `visual/test/` checks that:
  - every visual file imports only `../src` (type imports), `react`, or its own files;
  - `src/` and `interaction/` never import `visual/`.
- Type-checked with the bench's TypeScript settings (React lives there). The root `tsc` does not include `visual/`.
- The bench imports the panel from `../../visual`. It behaves as before; checked in the browser.
