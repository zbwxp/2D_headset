# Render / selection chain — what we wrote ourselves (for dot's review)

Purpose (dot, 2026-10-06): decide per piece whether to **hand back to a mature library**, **keep as
domain logic**, or **delete adapter code** — to reduce home-made rules, not to add tests around
patches. Claude lists; dot decides. "Mature counterpart" entries marked *checked* were read in the
installed source; *unchecked* ones are leads only.

Installed libraries: @tldraw/store + @tldraw/state + @tldraw/utils 5.5.2 (not @tldraw/editor),
fabric 7.4.0, bezier-js 6.1.4. Line numbers at commit `27520ac`.

## A. From records to one paint list (core)

| # | Piece | Where (lines) | What it does | Mature counterpart | Claude's tentative class |
| --- | --- | --- | --- | --- | --- |
| A1 | `paintKey` / `KEY_SEP` / `byKey` | evaluate.ts 46–69 (~24) | per-level (index, id) key of the whole container path; code-unit compare | `sortByIndex` (@tldraw/utils, *checked*: `a.index < b.index`) — per sibling pair only; tldraw's tree traversal is in @tldraw/editor (*unchecked*, not installed) | domain (our tree + references), comparison semantics = sortByIndex |
| A2 | `fromPaint` | evaluate.ts 70–87 (~18) | splits curves / fills; decides `ownInk` | — | domain (RC-16) |
| A3 | `evaluate` sort + reference keys | evaluate.ts 160–183 (~24) | full-recompute reference of the order | — | domain (independent reference) |
| A4 | `Derived.keys` / `order` / `all` | derived.ts 303–340 (~38) | cached order: identities + order only | tldraw `createComputedCache` / `computed` (used) | domain caching on library primitives |
| A5 | `unapplied*` reports | evaluate.ts 89–96 (~8) | depth offset / container opacity not applied, reported | — | domain (scope limits) |

## B. Drawing

| # | Piece | Where | What it does | Mature counterpart | Tentative |
| --- | --- | --- | --- | --- | --- |
| B1 | A-mode scene build + incremental diff | fabricView.ts 280–345 (~65) | `want` list (onion → paint → dots); replace changed objects in place (`insertAt`), move dots | Fabric has no keyed reconciliation that I know of (*unchecked*); tldraw renders shapes through React keys (@tldraw/editor, *unchecked*) | adapter — candidate to simplify if a library diffing exists |
| B2 | V-mode groups | fabricView.ts 347–399 (~50) | one Fabric `Group` per top-level container, in paint order | Fabric `Group` (used) | adapter (needed while V = Fabric transform box) |
| B3 | Onion skins, anchor dots | fabricView.ts ~232–245, 292 | editor aids (E1) | — | editor display convention |
| B4 | Own-ink compositing | view/ownInk.ts (79), view/ownInkFill.ts (27) | fill leaves out its own stroke ink (scratch layer, same stroke params) | none found: Fabric `clipPath` ignores stroke (*checked*, `drawObject(forClipping)`); v103 did the same job with an SVG inverse clip | domain; Fabric part = internal `_render` extension |
| B5 | `Canvas2DRef` (renderer B) | view/canvas2dRef.ts (97) | reference / benchmark renderer | — | experiment — keep or delete per the canvas decision |
| B6 | `inkStyle` | evaluate.ts 38 | one stroke definition (width / 3, butt, miter, limit 4) | Fabric / Canvas stroke props (used) | domain (one definition) |

## C. Selection and write-back

| # | Piece | Where | What it does | Mature counterpart | Tentative |
| --- | --- | --- | --- | --- | --- |
| C1 | `hitTest` | evaluate.ts 238–286 (~49) | our hit test on evaluated geometry: A anchors > handles > segments; V segments > fills; KF-4 lives here | Fabric `findTarget` (+ `perPixelTargetFind`, *unchecked* for groups with our own-ink fills); tldraw `getShapeAtPoint` (@tldraw/editor, *unchecked*) | open — the KF-4 fix must make it follow paint order; candidate to hand to Fabric per-pixel targeting if that respects z-order and our fill exclusion |
| C2 | `inkContains` | evaluate.ts 210–225 (~16) | native `isPointInStroke` with `inkStyle` | browser API (used) | domain glue |
| C3 | `routeVTarget` / `containerOfHit` | fabricView.ts 417–436 (~20) | our hit decides which Fabric group is `evented`, so Fabric's own target search lands on it | Fabric target search (used underneath) | adapter — exists because C1 and Fabric's search disagree; goes away if one of them owns V picking |
| C4 | A-mode drag (`onDown` / `onMove` / `onUp` / `commandFor`) | fabricView.ts 438–520 (~80) | our preview + one command on release; reference edits convert deltas | — (tool state machines in @tldraw/editor, *unchecked*) | domain (write-back rules) |
| C5 | V write-back (`onModified`) + re-entrancy guards | fabricView.ts 523–556 (~34), flags 37–44 | Fabric transform matrix → `transformContainer(s)`; ignores Fabric's re-entrant `object:modified`; cancel handling | Fabric transform box (used) | adapter — the guards exist because we re-project inside Fabric's event cycle |

## D. Notes for the review

- Generic-editor problems found today were in A1 (ordering), B2 (V group order) and C1 (picking vs
  order) — the pieces where we replaced library behaviour without verifying the replacement whole.
- The scratch-layer cost of B4 is real (B: 1.9 → 15 ms per frame with 100 protected fills).
- KF-4 (C1) and the new-fill placement (commands.ts `createFill`, uses the schema default index
  `a0`; allocation should use @tldraw/utils `getIndexBelow` / `getIndexBetween`) are pending.
