# Stage 3b summary: in-between correction on the lines (accepted by dot 1791698328)

**Scope** (bowen 1791692031, "那就先做线上修正吧"): corrections at angles **on the lines between neighbouring views**. A drag there changes the in-between curve of that line (the response) and, where the response cannot reach, moves the outer view by a candidate found from a per-control, per-axis cost and then checked against the constraints. That is not the smallest move of the whole correction under all its constraints, and a refused candidate does not prove that no other move would work (dot 1791694376, 1791698489). The bench can drag points during playback.

**Not delivered** (dot 1791698328):
- **Corrections inside a cell** (yaw and pitch both between views): refused (`correction-off-edge`). Candidates for later: bowen's "yaw handles x, pitch handles y" (1791691812), v103's local interior samples (open item 6 of `docs/stage3b-correction-plan.md`).
- **Undo during playback:** still refused in playback; ⌘Z after leaving undoes a correction in one step. Pending bowen (asked 1791696687).
- **Dragging handles in playback:** not built (core's `correct` takes handles; the bench drags points only). Pending bowen (asked 1791696687).
- **Appearance at a pose and smooth joins after the blend:** still placeholders (slots A and B, ledger row 9; bowen 1791684302).

## What exists now

- **Responses** (`animation`): per control (a point's position or one handle vector), per edge, per axis, a piecewise-linear curve through (0, 0), its knots, (1, 1). Each knot is a correction the user made at that angle: a protected target. Carried through structural edits (`follow`), paste and copy layer, the file (archive version 4), and links (linked points hold identical sets; a link merges them by the union of knots, refused if they differ).
- **`evaluate` with responses:** per control and axis, the responded weights in the pose's quadrant; `onEdge` is the same blend on an edge (one summation step); `PoseNotFinite` is a typed error.
- **Operations declare their effects** (`src/document/effects.ts`, ledger row 1 closed): what each operation reads, which layers its intents and writes may reach, its settle; the transaction merges them, and an undeclared operation fails its edit. At run time only the declarations and the layers of the geometric intents are checked; direct writes without intents are verified by one test per operation, not by complete write tracking (dot 1791689059, 1791698489).
- **`Editor.correct(pose, targets)`:**
  - only on a line (`edgeAt`: u = |yaw| / 90, v = |pitch| / 45); the target set is the given points with their link components, plus the given handles; locks are checked on the whole set;
  - per axis: already met → nothing; views differ → a knot on the response (overflow-free inverse); views equal on an edge from the front → the outer view moves by the candidate of a per-control, per-axis cost (end points 16, handles 1, response change 0.005, scale = the drawing's extent; v103's constants), solved in a scaled form; views equal elsewhere → `correction-axis-fixed`;
  - old knots on the outer view's edges are re-solved against its settled values; linked members' final response sets must be identical (`correction-link-differs`);
  - the final check runs on the settled trial against the draft on entry, per axis (`correction-not-reproduced`), plus `correction-not-finite`, `correction-breaks-target`, `correction-too-many-knots`;
  - stands alone in its edit (only selections and stroke broadcasts beside it); one undo step.
- **`correctionEdge(pose)`:** a pure root query with the same rule, for the bench.
- **`coordinates-not-finite`:** any non-finite coordinate, given or computed by a settle step, is a typed refusal; the edit rolls back.
- **Bench:** in playback, number fields beside the sliders (typed text kept apart from the pose); the status says whether the pose is on a line, at a view or in a cell; on a line, a visible point can be dragged (start + displacement) and the release makes one `correct`. The playback gate allows an edit only if it calls `correct` exactly once and nothing else; undo, keys, panels and Open stay refused. A press binds the frame's drawing; a changed drawing, a pose change, Esc, a right click, leaving playback, another App's press of the same pointer and the other cancel paths write nothing.

## Packages and accepted commits

| Package | Content | Code commits | Accepted at |
|---|---|---|---|
| 1 | operations declare their effects (ledger row 1) | dd63526, 417f480, e07f410 | e07f410 (dot 1791689059) |
| 2 | responses as data, evaluate with responses, follow, clip, file v4, links | 744b1b9, 31c532a, 7496dc7 | 7496dc7 (dot 1791691047) |
| 3 | `correct` on a line, response only | a4329a1, 1bed3ff, d6502dc | d6502dc (dot 1791693873) |
| — | `coordinates-not-finite` | 385707a | 385707a (dot 1791695246) |
| 4 | the outer view's move (a per-axis cost candidate, checked); ledger rows 13, 14 | 2e42f60, ed63549, 302b35c | 302b35c (dot 1791696516) |
| 5 | bench: dragging points during playback; `correctionEdge` | e2a7496, f1ed222, 1420d46, abece54 | abece54 (dot 1791698328) |

Tests at the end: root 750, bench 90, interaction 75; both type checks. dot re-ran all of them independently at each acceptance, with its own regressions (31, 50 and 27 cases for packages 3, 4 and 5).

**Verification boundary** (dot 1791698328): dot checked with a real mouse an off-centre drag that changes only the response, a correction that moves the side view, one undo step after leaving playback, the locked refusal and the disabled controls. The cancel paths, two Apps on one page, circular arguments and hidden neighbour lines were verified by DOM automation, not by real mouse use.

## Where it went wrong (bowen's three-strike rule)

Every package needed three commits or more; each has a summary:
- **Package 1** (summary 1791688895): declarations taken from a probe that never reached some branches; the observer seam ran while the Editor was still open.
- **Package 2** (summary 1791690813): knot lists validated with `map` (sparse holes skipped) and the same rule written twice; interpolation overflowed for extreme knots.
- **Package 3** (`docs/stage3b-pkg3-problems.md`): linked points assumed to coincide exactly (open allows 1e-9); the final evaluation's failure did not take a declared refusal path.
- **Package 4 plan** (`docs/stage3b-pkg4-solve-problems.md`): the exact optimum, the floating-point candidate and the constraint check were written as one thing.
- **Package 4 body** (`docs/stage3b-pkg4-body-problems.md`): the branch decided on a scaled value instead of r; composite keys parsed back; a success test that never exercised its title.
- **Package 5** (`docs/stage3b-pkg5-problems.md`): the gate placed after a step that can throw; the drawing bound at the press, not at the frame shown; one visibility rule written three times.

**The common pattern:** a property true in the common case or in exact arithmetic was relied on without checking where, and how strongly, it holds at each entry. The rules added along the way (each relied-on invariant listed with its entries and strength; every throw on the path mapped to a refusal; tests through the weakest entry; decision points on the named quantity; no parsed composite keys; a feature-off run for each success test; guards first; gestures bind the frame; one rule, one definition) are in `docs/stage3b-pkg3-problems.md`, `-pkg4-solve-problems.md`, `-pkg4-body-problems.md` and `-pkg5-problems.md`.

## Ledger

- Closed in 3b: rows 1, 4 (package 1), 5 (package 2), 13, 14 (package 4).
- Opened in 3b: row 12 (`net.data.arr` accepts sparse lists), row 15 (link averaging overflows near the largest numbers; refused, never wrong).
- Still open: 2, 3, 6, 7, 9, 10, 11, 12, 15.

## Next

The next item gets its rules first, for dot's check, before any code (dot 1791698328). bowen named the focus earlier: the multi-view editor, 插针 (pinning), and the expression editor framework. Which comes next is bowen's call; the candidates are in the message that accompanies this summary.
