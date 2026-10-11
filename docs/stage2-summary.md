# Stage 2 summary: shape broadcast from the front, fit, diagonal draft (accepted by dot 1791682195)

**Scope:** stage 2 of `docs/architecture-multiview.md` §5, as planned in `docs/stage2-plan.md`. It gives the nine views **editing tools**: the shape broadcast, fit, the "unbroadcast change" mark and the diagonal draft. It does **not** give angle playback: there is no turning of the head, no interpolation between views and no in-between correction yet (stage 3). "The nine views can be edited" does not mean "head-turn playback is done".

## What exists now

- **The angle baseline** (`base:angle`, module `animation`).
  - It is a record layer in every document from creation, a copy of the front.
  - It is not a view: it is never edited directly and never settled.
  - Its owner, `animation`, declares the role rules:
    - a new line's new points and handles take the drawn values, and an existing end point keeps its baseline;
    - a paste takes the clip's baseline, otherwise the clip's front;
    - split, delete, bind and unbind follow the kind-independent rules.
  - Only an owner grants `copyNew`. A file cannot grant it to another layer, and open checks this.
- **Shape broadcast** (`Editor.broadcastShape`, front only).
  - For the chosen lines, "front − baseline" is added to the other eight views, once per point, with handles as vectors.
  - Each view is written through its own `move` / `moveHandle`, so links and springs settle it as after a hand edit.
  - Zero differences are not written.
  - The baseline is then set to the front for exactly those points and handles.
  - One edit, one undo step.
- **Fit** (`Editor.fit`): the baseline is set to the front, and no view changes.
- **The mark** (`Core.pendingLines()`): it lists the lines whose front differs from the baseline. The bench shows an orange dot at those lines and a count.
- **Diagonal draft** (`Editor.draftCorners`, module `views`).
  - For the chosen lines, each of the four corners = front + (yaw view − front) + (pitch view − front), per point and per handle vector.
  - Per corner it is all or nothing:
    - a corner already equal to the formula gets no write;
    - otherwise every chosen point and handle there is written, so a spring cannot turn one that was already right (dot 1791681518).
  - The baseline and the other five views are untouched.
- **Interaction and bench:** an "Angle (shapes)" group (Broadcast shape / Fit / Draft corners), kept separate from "Broadcast stroke". Refusal reasons are shown in the status line.

## Limits kept on purpose

- **One stage-2 operation per edit** (`stage2-alone`). An edit may hold one broadcast, fit or draft, plus only selections and stroke broadcasts. Anything else in the same edit refuses the whole edit. This is a stated boundary of this stage, not a silent reordering.
- **Complete link scope.**
  - Broadcast and fit refuse a chosen point whose link partner is not an end of a chosen line (`broadcast-link-incomplete`, `fit-link-incomplete`, naming the partner).
  - Linked points with different pending changes refuse a broadcast (`broadcast-link-mismatch`).
  - *Known consequence:* creating a link moves the second point in every view but not in the baseline. The two lines then show as pending, and both sides need a fit together before a broadcast. Changing this is a separate discussion.
- **Archive format 3 does not read format 2** (or 1). There is no automatic migration; bowen redraws (decision 6).
- **Broadcast only from the front** (`broadcast-from-front`). Strokes, radii and end strokes are not part of the shape broadcast.
- **The expression baseline** is not built (stage 4).

## Packages and accepted commits

| Package | Content | Commits | Accepted at |
|---|---|---|---|
| plan | rules, read and write paths, tests | 3e948a7 … 1f49419 | before each package |
| 1 | the angle baseline record layer, owner rules, format 3 | 4bcff0e, 367a0af, 3dc5326 | 3dc5326 |
| 2 | shape broadcast, fit, the mark, the stage boundary | 4da788e (+ 1f49419 wording) | 4da788e |
| 3 | diagonal draft; interaction and bench | f14c3a4, 7766a2b | 7766a2b (1791682195) |

Tests: 512 root and 51 bench. dot ran them independently, along with both type checks and the real bench screens for the mark, shape broadcast, fit, the front-only refusal and the corner draft (1791682195).

**Verification boundary:** these were automated, not real mouse use:
- the complex timing cases (buttons interrupting a drag or box selection, a late pointer release);
- the smooth-join cases;
- dot's 12 App state regressions.

## Where it went wrong (bowen's three-strike rule)

- **Package 1, three commits.**
  - The owner's grant (`copyNew`) was first a flag a file could set. A rule about who may grant something must live in code. Data may carry only a copy of it, checked against the code at open.
  - A planned spring test was missed because tests were written from memory rather than from the plan's test list. Since then, every handover maps each planned test to a test name.
  - Summary posted 1791680830.
- **Package 3, two commits.**
  - The draft skipped values that already equalled the formula, one by one. At a smooth join that left one handle unheld, and the spring turned it.
  - Lesson: "nothing to do" must be judged for the whole unit being written (here a corner), not item by item. Once a unit is written, all of its chosen values are written.

## Open, not in stage 2

- **Stage 3:** angle playback, interpolation, and in-between corrections with response curves. The rules and flows come first, for dot's check, before any code.
- **Stage 4:** expressions and the expression baseline.
- **Later:** matching; lifting old files.
- **Proposals:**
  - whether auto-bind should consider only what an edit touched;
  - the bench Open request order;
  - whether creating a link should also move the baseline.
- **Graph rows** are still waiting for bowen's "写" (listed in `docs/stage1-summary.md`).
