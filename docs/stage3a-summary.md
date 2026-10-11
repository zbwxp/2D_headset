# Stage 3a summary: angle playback, read only (accepted by dot 1791686803)

**Scope:** the read-only half of stage 3 (`docs/stage3a-playback-plan.md`). The drawing can be computed and shown at any head angle between the nine views. It does **not** include the in-between correction (editing at an in-between angle, solved back into the views: stage 3b), expressions (stage 4), or finished playback rendering: appearance and smooth joins between views are placeholders (ledger row 9).

## What exists now

- **`evaluate`** (new module, pure, depends only on `geometry`):
  - blends geometry (positions, handle vectors, arc radii) bilinearly in each quadrant of the 3 × 3 view grid (dot 1791684410: one workable scheme for this grid, not claimed the only right one; turning speed is not promised smooth);
  - each view comes back exactly; on an axis, geometry is the linear blend of the two views on it; an unadjusted (drafted) corner gives back yaw change + pitch change;
  - two slots with placeholders (bowen 1791684302): **A**, appearance (width, profile, end strokes) from the dominant view; **B**, joins after the blend, unchanged;
  - refuses a pose out of range (`pose-out-of-range`) and an incomplete model (`model-incomplete`), checking every contributing view's own keys.
- **`Core.model()`** (a copy of the nine views as `evaluate` input) and **`Core.atPose(p)`**: the posed values are written into a scratch layer of a private copy and read with the same reader as any view, so arcs and fills come from `derived`. Only `snapshot()` and `geometry()`; nothing is published.
- **`open`** now requires the view layers to be exactly the nine view keys.
- **`joins.setRadiusHere`**: one layer's arc radius, nothing else.
- **Interaction `cancelAll()`**: ends every unfinished operation at every level, the pending cut included; not an edit.
- **Bench playback:** yaw / pitch sliders draw `atPose`. Entering ends any gesture and unfinished operation. While posing, nothing writes: panels in disabled fieldsets (Save outside), keys stopped first, no canvas press, and the App's own logged Core refuses every edit / undo / redo. An Open read that returns after a later Open or after playback was entered is dropped.

## Packages and accepted commits

| Package | Content | Commits | Accepted at |
|---|---|---|---|
| plan | rules, read paths, slots, bench flow | 1ee6be0 … f2bc3fb | dot 1791684410 |
| 1 | `evaluate` and its two slots | 5d3f960, 9f1a857, e67640e | e67640e (dot 1791685075) |
| 2 | `model()`, `atPose()`, nine-view check at open | d297ff8, 85a7dcc, 802bca2 | 802bca2 (dot 1791685440) |
| 3 | bench playback, `cancelAll()`, Open order | 21697fd, 8e378f3 | 8e378f3 (dot 1791686803) |

Tests: root 531, bench 63, interaction 75; both type checks. dot re-ran all of them independently and checked the real bench screens (sliders, hidden selection colours, refused writes, editing and undo after leaving) (1791686803).

**Verification boundary** (dot 1791686803): cancelling a drag midway, late events, and Save content with full history unchanged were verified by DOM automation, not by real mouse use; the downloaded file's content on disk was not checked.

## Where it went wrong (bowen's three-strike rule)

- **Package 1, three commits.** A declared refusal (`model-incomplete`) was checked only as a side effect of reading values: first by the first view's keys, then by plain indexing that read inherited names. Summary 1791685061. Lesson: list every refusal's edges and test each before handing in.
- **Package 2, three commits.** The inherited-name fix was applied only where pointed out, not swept across the new code; and `model()` relied on nine views that `open` never enforced. Summary 1791685394. Lessons: sweep all new code for a fixed bug class in the same commit; find where every relied-on invariant is enforced at the data entry point.
- **Process:** package 2 was written before package 1 was accepted (dot 1791684959). The rule is: the next package is not written until the previous one is accepted.
- **Package 3, two commits.** The read-only flag and its wrapper were module-level, so another App could switch them off (dot 1791686247); they now belong to each App.

## Ledger

- Closed: row 8 for one App (Open order, late return across playback).
- Opened: row 11 (an Open from an unmounted App), row 10 (`EndStroke` type allows `undefined`).
- Still open: row 9 (slots A / B are placeholders), row 1 (commit settling by name lists, to be consolidated with stage 3b).

## Next

Stage 3b, the in-between correction: rules and flows first, for dot's check, including the consolidation of ledger row 1 (operations declare their effects; the transaction checks and merges them; a missing declaration is an error).
