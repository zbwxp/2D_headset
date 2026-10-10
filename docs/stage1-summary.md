# Stage 1 summary: nine-view editing (accepted by dot 1791657560)

**Scope:** stage 1 of `docs/architecture-multiview.md` §5. It does not include the shape broadcast from the front, fit, expressions, angle playback / interpolation, matching or the right-side mirror draft.

## What exists now

- **Nine views from the start.** Every document has `view:Y,P` for yaw −90 / 0 / +90 × pitch −45 / 0 / +45.
- **Structure once, shapes per view.**
  - Connections, names, order, fills, join modes and links are stored once.
  - Positions, handles, line width / profile, arc radii and end strokes are stored per view.
- **Edit in any view** (`editIn(view)`, `in(view)`).
  - A new line appears in all nine views at the drawn place.
  - Moving or reshaping changes only that view.
  - Split, delete, bind and unbind reach every view by fixed rules.
- **One edit, one undo step, across all views.** A refused edit writes nothing anywhere.
- **Auto-bind only in the edited view** (Q2).
  - A chance coincidence in another view stays two points, also through save / open.
  - An edit that only selects or broadcasts strokes moves nothing.
- **Mirror apply / link only at 0,0.** Off the front, anything that would act on a mirror pair is refused (`mirror-front-only`).
- **Stroke broadcast:** the selected lines' width, profile and end tapers, from the current view to the others.
- **Names:**
  - layer names are unique in the document; line and curve names are unique within their layer;
  - a rename keeps the id;
  - paste, layer copy and cut-and-paste name by the target layer (kept when free, else "副本").
- **元组件 type:** part of the document, undoable and saved; copying a layer copies its type.
- **Bench:** a 3 × 3 view picker, editing in any view, and a "Broadcast stroke" button.

## Steps and accepted commits

| Step | Content | Accepted at |
|---|---|---|
| 1 | shape layers, layer-bound handles | b31e78d |
| 2 | structural changes in every layer | 5d7a727 |
| 3 | edit in a chosen view, per-layer settle | 498c08a |
| 4 | arc radius and end strokes per view | f138c84 |
| 5 | name scope, meta (type, lookup) | 9f9fa7a |
| 6 | stroke broadcast | f48a627 |
| 7 | interaction and bench view picker | 0496cc4 |

Tests: 479 core + interaction and 50 bench, run independently by dot (1791657340, 1791657560).

**Verification boundary:** switching views in the middle of a pointer gesture is tested with jsdom window events, not timed in a real browser.

## Where it went wrong (bowen's three-strike rule)

- **Step 2, paste layer mapping, three commits.** Role-specific rules were put into the shared mechanism. Summary posted 1791653145.
- **Step 3, edit in a view, three commits.** Reads in the middle of an edit (trial, link positions, lock baselines) were single-view. Summary posted 1791654051. Since then, every step first lists its read paths.
- **Process slips:** b216171, 8cb3a21 and 5f99f0a were pushed with a dot objection unread.
  - The first two came from filtering messages by my own post's time.
  - The third came from checking messages and pushing in one command.

  Message checks are now their own step.

## Open, not in stage 1

- **Stage 2:** the shape broadcast from the front (baselines), fit, the "unbroadcast change" mark, diagonal drafts.
- **Stage 3:** angle playback, interpolation, in-between corrections.
- **Stage 4:** expressions.
- **Later:** matching.
- **Proposals:** whether auto-bind should only consider what an edit touched; the bench Open request order.
- **Graph rows** written only when bowen says "写":
  - the right-side mirror draft row is to be withdrawn;
  - the "to confirm" note on continuous-curve names is to be removed (confirmed);
  - new rows: drawing order shared; width and end strokes per view with a broadcast button (an assignment); bind in all views; auto-bind judged in the edited view; mirror at 0,0 only.
