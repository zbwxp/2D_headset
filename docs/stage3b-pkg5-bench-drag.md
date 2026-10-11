# Stage 3b, package 5: dragging during playback in the bench — the interaction flow, before code

**Status:** first draft for dot's check (asked by dot 1791696516). No code until dot accepts it. Packages 3 and 4 are accepted (`d6502dc`, `302b35c`).

**What this is:** the bench is throwaway glue (bowen 1791477975: graph parts pristine, glue fastest). This package adds one gesture to playback: drag a point (or a handle) at the pose shown, and on release make one `correct` edit. All rules stay in core; the bench only picks, previews, calls and shows the result. Quick pass (bowen 1791556525): build the ask minimally, fix only use-breaking bugs, record edge cases.

**Ledger check:** no row is triggered. Row 6 (read entries) is not touched: the bench picks from `PoseReader.snapshot()`, an existing read, and adds no read API. Row 11 (bench Open across Apps) is unchanged: Open stays disabled in playback.

## 1. Choosing a correctable angle

- The yaw and pitch sliders stay (integer steps). Next to each, a number field takes any value (bowen's own example, 31.35°: 1791691700 thread), clamped by the slider's range.
- The status line says where the pose is, read from the same rule as core (`u = |yaw| / 90`, `v = |pitch| / 45`):
  - on a line: `on the line view:0,0 → view:90,0 at t = 0.348 · drag a point to correct`;
  - at a view: `at view:90,0 · read only (edit the view itself)`;
  - inside a cell: `inside a cell · read only (this round corrects on lines only)`.
- **The rule is not duplicated in the bench.** The status text comes from core: the bench calls `edgeAt` through a new root export `correctionEdge(pose)` that returns `{ edge, t }` or the refusal (code and message), without writing. *Alternative if dot prefers no new export:* the bench shows nothing up front and the drag's own refusal (§5) tells the user on release.
- Picking is enabled only when the pose is on a line; elsewhere a press does nothing (no gesture starts), so a drag in a cell cannot be lost on release.

## 2. Picking a point or a handle

- **Points:** every point of the posed drawing (`PoseReader.snapshot().points`) within `REACH.point · px` of the press (interaction's `REACH`, 10 screen px, so the reach matches editing), nearest first.
- **Handles (pending bowen, §7.2; not a confirmed rule):** if bowen agrees, the handle tips of the posed drawing (point + vector, non-zero vectors only) within `REACH.handle · px`, drawn as small squares only during playback on a line. Within reach, a point wins over a handle at equal distance (as interaction's A tool).
- **Locked or hidden lines:** picked as usual; core refuses locked ones (`locked`), so the refusal is the one source of the rule.
- **Linked points:** picking one is enough; core expands the link component. The ghost (§3) shows only the picked point; the others follow on commit.
- **One control per drag.** No multi-selection in playback (selection marks stay hidden there, dot 1791686247).

## 3. Preview and commit

- **During the drag:** a ghost only, no core call. The picked point drawn at the pointer, and the lines ending there redrawn with that end moved (as the editing ghost does); for a handle, its line with that handle moved. The posed drawing underneath is unchanged.
- **On release:** one edit, `core.edit(e => e.correct(pose, { points: [{ id, position }] }))` (or `handles: [{ line, end, vector }]`), through the App's logged wrapper. An unmoved press (≤ `CLICK` screen px) commits nothing.
- **After a commit:** the pose stays; the drawing is re-read with `atPose`, so the corrected angle shows the target and the views that moved (package 4) show in the nine-view panel after leaving playback. The log shows the call and `ok` or the refusal.
- **Undo (pending bowen, §7.1; not a confirmed rule):** proposed to stay refused in playback (§4); leaving playback and pressing ⌘Z undoes the whole correction in one step (knots and any moved view).

## 4. The read-only gate: widened for `correct` only

Today `loggedFor(readOnly)` refuses every edit, undo and redo while posing (dot 1791683911, 1791686247). Package 5 changes exactly this:
- **An edit is allowed in playback, but every Editor call inside it must be `correct`.** The logged Editor proxy throws `read-only-playback` on any other call, so the edit fails and publishes nothing. One `correct` per edit (core's `alone` rule refuses two anyway).
- **Undo and redo stay refused in playback** — today's behaviour, kept unless bowen decides otherwise (§7.1, pending). Unlocking them would let a playback undo remove an edit made before playback.
- **Every other path stays as today:** tool keys return early while posing; the editing panels and Open are in disabled fieldsets; the canvas's editing press is not attached; the interaction module is not called during playback at all.
- The gate stays per App (its own `posing` ref and wrapper).

## 5. Cancel, mode switches and refusals

**Flows, each with its after-state** (no edit, nothing published, the gesture's window listeners removed):

| Event during a drag | After |
|---|---|
| Esc | drag cancelled; pose and drawing unchanged |
| right click, or a right press | drag cancelled |
| pointercancel, window blur, a new press of the same pointer | drag cancelled |
| a slider or number field changes the pose | drag cancelled first, then the pose changes (a target belongs to one pose) |
| Leave playback | drag cancelled, then playback left |
| the App unmounts | drag cancelled |
| release | one `correct` edit (§3) |

- The drag uses the bench's existing single gesture slot (`gesture.current`, one cancel path; dot 1791552803), so a playback drag and any other gesture never coexist.
- **Refusals:** the refusal of the `correct` edit (any code: `correction-*`, `locked`, `pose-not-finite`, `coordinates-not-finite`) is shown in the status line in red, with names (`withNames`), and as a red cross on each object it names, drawn on the posed drawing. It stays until the next press, pose change or leaving playback. Nothing else changes (core published nothing).

## 6. Tests (bench, jsdom, through the App as a user drives it)

Each success test is also run with its feature switched off and must fail then (`docs/stage3b-pkg4-body-problems.md` rule 3).

- **On a line:** drag a point at yaw 45 → one `correct` edit in the log, the posed point at the target, one undo step after leaving playback. Feature off (no commit on release) → fails.
- **Handle (only if bowen agrees to §7.2):** drag a handle tip → `correct` with `handles`; the posed handle at the target.
- **A move case:** a point equal in front and side dragged at yaw 45 → the side view's point moved (read after leaving playback).
- **Not on a line:** at a view and inside a cell, a press starts no drag and no edit; the status says why.
- **Refusal:** a locked line's point dragged → `locked` in red in the status, a cross on the line, nothing published, the cross gone after the next press.
- **The gate:** during playback, with the drag gesture present: tool keys, ⌘Z / ⇧⌘Z, the panel's buttons and Open still write nothing (the existing playback tests kept); an edit calling `move` through the wrapper in playback → `read-only-playback`, nothing published; an edit calling only `correct` → allowed.
- **Cancel flows:** each row of §5's table → no edit, the log unchanged, no window listener left (pointermove after the cancel does nothing).
- **Per App:** two Apps, one in playback dragging, the other editing → the other's edits unaffected; unmounting the posing App cancels its drag.

## 7. Questions for bowen — pending, not rules (asked 1791696687; dot 1791696734)

Neither is treated as decided. Until bowen answers: undo and redo keep today's behaviour (refused in playback, nothing new is unlocked), and handle dragging is not built; points only.

1. **Undo inside playback:** recommended *no* this round (⌘Z works after leaving playback). Allowing it safely needs "undo only corrections made in this playback", which is a design of its own.
2. **Handles in playback:** recommended *shown and draggable only on a line*, as small squares, since `correct` supports them. The alternative is points only, fewer marks on the drawing.

## 8. Not in package 5

- No live preview through core (no dry run exists); the ghost is geometric only.
- No drag inside a cell (later, open item 6 of the plan).
- No change to interaction's module, to core, or to the editing gestures; the only core-side addition is the root export of §1 (dropped if dot prefers).
