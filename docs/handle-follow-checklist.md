# Handle follow and Straight (S) — checklist before any code, for dot's review

Asked by bowen 1791941335 (the eyelash: after moving and scaling, a shape's relative positions and its handles' relative positions should hold; "handle follow"; a key that makes a Bézier line straight between its ends; joins then only cusp / bound, smooth ones may fly). Decided: bowen 1791944499 — 100 % follow, rotation **and** length; **S = Straight** (Split keeps its tool, loses its key); handles at 1/3 and 2/3 of the chord. dot 1791945071 agreed. Backlog row 7 (bowen 1791464648: "v103's 40 % handle following") is this item. v103: `src/domain/drawing/nodeDrag.ts` (7205381).

Interaction only: no core change, no stored relation (as v103: "the result is ordinary cubic geometry, with no persisted follow relation").

## 1. Handle follow
- **When:** a move of the selection — a drag with V or A, and an arrow-key run (`selectTransform`'s one target; one `translate` commit). Not rotate / scale by the box, not links or binds settled by core (recorded).
- **Which handles:** every line with an end point that the move takes. For each such line: old chord = b − a before, new chord = b′ − a′ after. The line's **similarity** S (the rotation and the length ratio taking the old chord to the new) is applied to each of its two handle offsets — except a handle the move itself takes (a selected handle, or a handle of a selected line: it moves with the move as today). A line whose two ends move together keeps its chord, so S = identity: nothing changes.
- **Smooth joins (v103's rule):** at a smooth join whose two lines both turn, the two ends there turn by one shared angle, the turns weighted by the lines' old chord lengths (v103 `nodeDrag.ts`); each keeps its own length ratio. The join stays smooth.
- **Degenerate:** an old or new chord shorter than 1e-9 → that line's handles do not follow (v103 fades its turn near a collapsed chord; here: unchanged).
- **The switch:** 「手柄跟随」 in the toolbar, **on by default** (a drawing tool option, not saved in the drawing); off = today's behaviour.
- **One edit, one undo step:** the `translate` and the handles' `moveHandle` calls in the same edit.
- **Frozen at the start** (dot 1791946066): the drawing as it was when the drag began and the switch's state are taken then; every preview and the commit are computed from that one state (never from the last preview), and a line two moved ends share is computed once.
- **The drag ghost is core's preview of the release's op** (dot 1791946066, as the deform tool): the translate and the followed handles as one op, previewed through `core.preview` (its settle, mirror and links included) and committed as the same op; the ghost draws every line it changes (`Preview.drag.lines`). About 7 ms a move on 211.json.
- Points moved by links or binds are settled by core as today: their lines' handles are not promised to keep their shape.

## 2. Straight (S)
- **S** (no modifier, focus not in a field) with lines selected: each selected line's handles go to its chord at 1/3 and 2/3 (`ha = (b − a)/3`, `hb = (a − b)/3`) — a straight line. One edit, one undo step. With no line selected: the status line says 「先选中要拉直的线」 and nothing changes. With V a selected curve's lines all go straight.
- **Joins are not changed.** A smooth join's spring may pull the straightened handles off again — left as it is (bowen 1791941335: "圆滑这么做完 handle 飞了就飞了").
- **Split loses its key** (S); the tool and its button stay.
- **Typing in a field:** S types the letter, never straightens (dot 1791945071).

## 3. Evidence
- interaction: a three-line closed triangle with bent lines — drag one corner with A: the two lines at that corner keep their shape relative to their chords (handle offsets rotated and scaled exactly; the third line untouched); drag two corners together (both ends of one line): that line unchanged, the other two follow; switch off: today's offsets; a selected handle moves as today; a smooth join stays collinear; one undo step; arrow nudge follows too.
- S: selected lines straight (handles at 1/3, 2/3); no selection → the message, nothing written; a field focused → no change; Split has no key.
- bench: the toolbar switch, the ghost equals the result at release; a screenshot of 211.json's eyelash dragged at one corner, before / after.

## 4. Not in this round
Follow for box rotate / scale and for points moved by links or binds; the eyelash prototype / instance (set aside, dot 1791945071).
