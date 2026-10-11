# Stage 3b, package 5: dragging during playback in the bench — the interaction flow, before code

**Status:** accepted for coding by dot 1791696958 (point dragging; undo in playback and handles stay pending bowen, §7). `correctionEdge` approved as a pure query with core's own rule.

**Coded** (for dot's check): `correctionEdge` in `src/animation/index.ts`, exported from `src/index.ts` (test `test/correction-edge.test.ts`: it answers what `correct` does at the same pose); the bench in `bench/src/app.tsx` (the gate in `loggedFor`, `onPoseDown`, `changePose` / `typePose`, Esc first, the cross-App cancel in the editing gesture, the status, ghost and refusal marks, `window.bench.edit` for tests); tests `bench/test/playback-drag.test.tsx`. Checked by 16 single mutations and a feature-off run (no commit on release): each makes at least one test fail. Packages 3 and 4 are accepted (`d6502dc`, `302b35c`).

**What this is:** the bench is throwaway glue (bowen 1791477975: graph parts pristine, glue fastest). This package adds one gesture to playback: drag a point (or a handle) at the pose shown, and on release make one `correct` edit. All rules stay in core; the bench only picks, previews, calls and shows the result. Quick pass (bowen 1791556525): build the ask minimally, fix only use-breaking bugs, record edge cases.

**Ledger check:** no row is triggered. Row 6 (read entries) is not touched: the bench picks from `PoseReader.snapshot()`, an existing read, and adds no read API. Row 11 (bench Open across Apps) is unchanged: Open stays disabled in playback.

## 1. Choosing a correctable angle

- The yaw and pitch sliders stay (integer steps). Next to each, a number field takes any value (bowen's own example, 31.35°), within the slider's range.
- **The field's text and the pose are kept apart** (dot 1791696847): the text being typed is the field's own; the pose changes only when the text parses to a finite number in range. An empty field, a lone "−", or anything else invalid leaves the pose as it was (never 0 or NaN) and is shown as invalid. Only a valid change of the pose cancels a drag and updates the drawing.
- The status line says where the pose is, read from the same rule as core (`u = |yaw| / 90`, `v = |pitch| / 45`):
  - on a line: `on the line view:0,0 → view:90,0 at t = 0.348 · drag a point to correct`;
  - at a view: `at view:90,0 · read only (edit the view itself)`;
  - inside a cell: `inside a cell · read only (this round corrects on lines only)`.
- **The rule is not duplicated in the bench.** The status text comes from core: the bench calls `edgeAt` through a new root export `correctionEdge(pose)` that returns `{ edge, t }` or the refusal (code and message), without writing. *Alternative if dot prefers no new export:* the bench shows nothing up front and the drag's own refusal (§5) tells the user on release.
- Picking is enabled only when the pose is on a line; elsewhere a press does nothing (no gesture starts), so a drag in a cell cannot be lost on release.

## 2. Picking a point or a handle

- **Points:** every point of the posed drawing (`PoseReader.snapshot().points`) within `REACH.point · px` of the press (interaction's `REACH`, 10 screen px, so the reach matches editing), nearest first.
- **Handles (pending bowen, §7.2; not a confirmed rule):** if bowen agrees, the handle tips of the posed drawing (point + vector, non-zero vectors only) within `REACH.handle · px`, drawn as small squares only during playback on a line. Within reach, a point wins over a handle at equal distance (as interaction's A tool).
- **Hidden controls are not picked** (dot 1791696808): a point only if at least one line ending at it is visible (a hidden layer is its lines hidden; layers carry no visibility of their own). Among visible controls the nearest wins, so a hidden one never covers a visible one.
- **Locked and visible:** picked as usual; core refuses it (`locked`), so the refusal is the one source of the rule.
- **Linked points:** picking one is enough; core expands the link component. The ghost (§3) shows only the picked point; the others follow on commit.
- **One control per drag.** No multi-selection in playback (selection marks stay hidden there, dot 1791686247).

## 3. Preview and commit

- **What a press binds** (dot 1791696808): the drawing (the `core` object and its saved text, `save(core)`), the pose, the picked control, and its position at the pose at the press. The target is that position plus the pointer's displacement since the press, so a press off the point's centre does not make the point jump to the pointer.
- **During the drag:** a ghost only, no core call. The picked point drawn at its start plus the pointer's displacement (not at the pointer; dot 1791696958), and the lines ending there redrawn with that end moved (as the editing ghost does); for a handle, its line with that handle moved. The posed drawing underneath is unchanged.
- **On release, first a check:** if the `core` object or its saved text is not what the press bound (another App on the page edited, undid or opened a file meanwhile; they share the module's `core`), the drag is cancelled with a note in the log (`drag cancelled: the drawing changed during the drag`) and nothing is written. Not only leaving playback cancels it.
- **Then one edit:** `core.edit(e => e.correct(pose, { points: [{ id, position }] }))` (or `handles: [{ line, end, vector }]`), through the App's logged wrapper. An unmoved press (≤ `CLICK` screen px) commits nothing.
- **After a commit:** the pose stays; the drawing is re-read with `atPose`, so the corrected angle shows the target and the views that moved (package 4) show in the nine-view panel after leaving playback. The log shows the call and `ok` or the refusal.
- **Undo (pending bowen, §7.1; not a confirmed rule):** proposed to stay refused in playback (§4); leaving playback and pressing ⌘Z undoes the whole correction in one step (knots and any moved view).

## 4. The read-only gate: widened for `correct` only

Today `loggedFor(readOnly)` refuses every edit, undo and redo while posing (dot 1791683911, 1791686247). Package 5 changes exactly this:
- **An edit is allowed in playback only if it calls `correct` exactly once and nothing else** (dot 1791696773). Checked at the level of the whole edit, not only per call:
  - the logged Editor proxy throws `read-only-playback` on any other call, **and remembers it**: the callback may catch that throw and go on, so the throw alone does not fail the edit (it happens outside core's operations, so core does not mark the transaction failed);
  - the wrapper counts the `correct` calls;
  - when the callback returns, before control goes back to core, the wrapper throws `read-only-playback` if a forbidden call was seen or the count is not exactly 1. A throw from the callback makes core publish nothing.
  - **The callback's own result is returned to core unchanged** (dot 1791696847): core refuses a callback that returns a promise ("edit callbacks must be synchronous"); the wrapper calls the callback, checks, and returns what it returned, so an async callback is still refused, not passed off as a synchronous success.
  - **An empty edit is refused too:** core settles an empty edit fully, which may bind points that coincide legitimately; "no other call" is not enough.
- **Undo and redo stay refused in playback** — today's behaviour, kept unless bowen decides otherwise (§7.1, pending). Unlocking them would let a playback undo remove an edit made before playback.
- **Every other path stays as today:** tool keys return early while posing; the editing panels and Open are in disabled fieldsets; the canvas's editing press is not attached; the interaction module is not called during playback at all.
- The gate stays per App (its own `posing` ref and wrapper).

## 5. Cancel, mode switches and refusals

**Flows, each with its after-state** (no edit, nothing published, the gesture's window listeners removed):

| Event during a drag | After |
|---|---|
| Esc | drag cancelled; pose and drawing unchanged |
| right click, or a right press | drag cancelled |
| pointercancel, window blur, a new press of the same pointer — in this App or **in another App on the page** | drag cancelled |
| a slider or number field changes the pose | drag cancelled first, then the pose changes (a target belongs to one pose) |
| Leave playback | drag cancelled, then playback left |
| the App unmounts | drag cancelled |
| the drawing changed since the press (another App's edit, undo, redo or Open) | detected at release: drag cancelled, nothing written |
| release | one `correct` edit (§3) |

- **Event order** (dot 1791696958):
  - Esc is handled first in the key handler, before playback's early return and before the typing guard, so Esc cancels a drag even with a number field focused (and does nothing else in playback);
  - a right click anywhere in the window, not only on the canvas, cancels the drag (a window `contextmenu` listener for the gesture's life);
  - another pointer's move, up or cancel never ends this pointer's gesture (each listener checks `pointerId`).
- Every cancel removes all of the gesture's window listeners, each added one removed once.
- The drag uses the bench's existing single gesture slot (`gesture.current`, one cancel path; dot 1791552803), so a playback drag and any other gesture never coexist within an App.
- **Across Apps** (dot 1791696828): `gesture.current` is one per App, so a new press of the same pointer in another App would not reach this App's `onDown`, and this App's window `pointerup` listener would still commit on that press's release. So every gesture also listens on the window, in the capture phase, for `pointerdown` of its own pointer, and cancels itself there. This is in the shared gesture code, so editing gestures get it too; it fixes an existing gap of the same kind as ledger row 11, not a playback-only rule.
- **Refusals:** the refusal of the `correct` edit (any code: `correction-*`, `locked`, `pose-not-finite`, `coordinates-not-finite`) is shown in the status line in red, with names (`withNames`), and as a red cross on each object it names, drawn on the posed drawing. It stays until the next press, pose change or leaving playback. Nothing else changes (core published nothing).

## 6. Tests (bench, jsdom, through the App as a user drives it)

Each success test is also run with its feature switched off and must fail then (`docs/stage3b-pkg4-body-problems.md` rule 3).

- **On a line:** drag a point at yaw 45 → one `correct` edit in the log, the posed point at the target, one undo step after leaving playback. Feature off (no commit on release) → fails.
- **Handle (only if bowen agrees to §7.2):** drag a handle tip → `correct` with `handles`; the posed handle at the target.
- **A move case:** a point equal in front and side dragged at yaw 45 → the side view's point moved (read after leaving playback).
- **Not on a line:** at a view and inside a cell, a press starts no drag and no edit; the status says why.
- **Off-centre press:** a press 6 screen px from the point and a 20-px drag → the target is the point's position + 20 px, not the pointer.
- **Hidden and covered:** a point on a hidden line next to a visible one, pressed nearer the hidden one → the visible one is picked; a point whose lines are all hidden (a hidden layer) is never picked. Only the existing visibility flags are used, no fill occlusion or pixel hit testing (dot 1791696828).
- **Same pointer, two Apps:** A drags in playback, the same pointer presses in B, then releases → A's drag is cancelled at B's press and writes nothing; B's own gesture alone acts; a late release delivered after that writes nothing for A.
- **Number fields:** typing "", "-", "1e999", "abc" leaves the pose and an ongoing drag unchanged; "31.35" sets the pose and cancels the drag.
- **The drawing changes during the drag:** a second App on the page edits (and, separately, opens a file) between press and release → the release writes nothing, the log says why; the other App's change stands.
- **Refusal:** a locked line's point dragged → `locked` in red in the status, a cross on the line, nothing published, the cross gone after the next press.
- **The gate, through the wrapper's real calls** (a test hook `window.bench.edit` runs a callback through the App's own logged wrapper; dot 1791696773: not only disabled buttons):
  - `correct`, then a forbidden call whose throw the callback catches, then return → nothing published;
  - the reverse order (a caught forbidden call, then `correct`) → nothing published;
  - an empty edit → refused, nothing settled or published (a fixture with two coincident points in one layer that a full settle would bind);
  - two `correct` calls → refused;
  - an async callback that calls `correct` once → refused by core's synchronous check, nothing published;
  - exactly one `correct` → published;
  - and as today: tool keys, ⌘Z / ⇧⌘Z, the panel's buttons and Open write nothing during playback (the existing playback tests kept).
- **Cancel flows:** each row of §5's table, plus Esc with a number field focused, a right click outside the canvas, and another pointer's move / up / cancel (which must not end the drag) → no edit, the log unchanged. After every cancel a late `pointerup` of the original pointer is delivered and commits nothing; window listeners are counted (each `addEventListener` matched by a `removeEventListener`), not only checked by a pointermove that changes nothing.
- **Per App:** two Apps, one in playback dragging, the other editing → the other's edits unaffected; unmounting the posing App cancels its drag.

## 7. Questions for bowen — pending, not rules (asked 1791696687; dot 1791696734)

Neither is treated as decided. Until bowen answers: undo and redo keep today's behaviour (refused in playback, nothing new is unlocked), and handle dragging is not built; points only.

1. **Undo inside playback:** recommended *no* this round (⌘Z works after leaving playback). Allowing it safely needs "undo only corrections made in this playback", which is a design of its own.
2. **Handles in playback:** recommended *shown and draggable only on a line*, as small squares, since `correct` supports them. The alternative is points only, fewer marks on the drawing.

## 8. Not in package 5

- No live preview through core (no dry run exists); the ghost is geometric only.
- No drag inside a cell (later, open item 6 of the plan).
- No change to interaction's module or to core's rules; the only core-side addition is the root export of §1. The shared gesture code does change (the cross-App cancel of §5), so editing gestures get it too.
