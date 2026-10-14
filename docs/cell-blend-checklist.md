# Inside a cell: blend the edges' results, not their ratios — checklist before any code, for dot's review

## The ask
**bowen 1791988696:** at yaw 28 / pitch −35 the left eye twists (161.json); nowhere else.

## The cause (dot 1791989029, 1791989176)
- The correction at (30, −45) is right on its edge.
- On the pitch −45 edge, the outer eye corner's two views are only −0.82 apart in x. The stored response value there is about −4.
- **Inside the cell, today's formula (`docs/stage3b-pkg2-responses.md` §2) does this:**
  - it mixes the edges' *ratios* into one u′ = (1 − v)·r_bottom(u) + v·r_top(u);
  - it then applies u′ to the bilinear blend of all four views.
- At (28, −35) that ratio multiplies a blended span of about +2.84: the opposite sign of the edge's own −0.82.
- The point is pulled about 8.8 the wrong way; two neighbours move about 5 the other way; the eye lines cross.
- **dot's checks:**
  - removing the −45 edge's knots removes the crossing; removing the pitch 0 edge's does not;
  - removing one point's knots leaves other crossings, so deleting corrections is no fix.

## The decision
**bowen 1791989710, after 1791989428 / 1791989662:** *move first, then blend with the surroundings*. Each edge applies its own response to its own two views; inside the cell the edges' results are blended. This is the Coons patch (bilinearly blended transfinite interpolation), the standard construction of CAD surfaces from four boundary curves.

**Stored data unchanged.** The knots, the file and the archive version are unchanged; only `evaluate` changes.

## 1. The rule (per control and axis, in the pose's quadrant)
**The four corner values:** F = (0, 0), Y = (±90, 0), P = (0, ±45), C = (±90, ±45). Each edge's own result is today's `onEdge`:
- E_b(u) = (1 − r_b(u))·F + r_b(u)·Y — the pitch 0 edge;
- E_t(u) = (1 − r_t(u))·P + r_t(u)·C — the quadrant's pitch edge;
- E_l(v) = (1 − s_l(v))·F + s_l(v)·P — the yaw 0 edge;
- E_r(v) = (1 − s_r(v))·Y + s_r(v)·C — the quadrant's yaw edge.

**Inside the cell (0 < u < 1 and 0 < v < 1):**
- S = (1 − v)·E_b(u) + v·E_t(u) + (1 − u)·E_l(v) + u·E_r(v) − B, where B is 3a's bilinear blend of F, Y, P, C.
- **As weights on the four views** (still linear in them, so `blend` is unchanged):
  - w_F = (1 − v)(1 − r_b) + (1 − u)(1 − s_l) − (1 − u)(1 − v)
  - w_Y = (1 − v)·r_b + u(1 − s_r) − u(1 − v)
  - w_P = v(1 − r_t) + (1 − u)·s_l − (1 − u)·v
  - w_C = v·r_t + u·s_r − u·v
  - They sum to 1.
- **No responses:** every r and s is the identity, so each E is linear and S is exactly 3a's bilinear blend.

**On an edge or at a view** (u or v is 0 or 1): that edge's two weights, 1 − r and r, exactly as today. This is a separate branch, so the edge's numbers stay bit for bit those `onEdge` and `correct` use, and the views stay exact.

**Unchanged:**
- a control with no response on its four edges takes 3a's path (bit for bit);
- slot A (appearance) and the zones keep the geometric weights;
- weights may be negative or above 1, and only exact zeros are skipped;
- refusals (`model-incomplete`, `pose-not-finite`) are as today.

**Continuity:** neighbouring cells share their edges, and S on an edge equals that edge's E. So S is continuous across cell borders, 0° included.

**What it does not promise** (dot 1791989488):
- it stops one edge's ratio being used against another edge's span;
- it does not promise that no shape ever crosses. Edges whose corrected shapes contradict each other can still cross between them.

## 2. Where
- `src/evaluate/index.ts` `responded`: the weights above; the edge branch.
- `docs/stage3b-pkg2-responses.md` §2: the formula replaced, with a pointer here.
- **Nothing else:** `correct` (edge-only), `uncorrect`, the archive, the bench and the batch tools are unchanged.

## 3. Evidence
**Core:**
- **Exactness:** at the nine views the result is the view; on each of the 12 edges it is `onEdge` at progress t (several t, several knot sets, negative values).
- **No responses:** equal to 3a everywhere.
- **Only one edge's knots** (e.g. the top): on that edge, the knots apply; on the opposite edge, linear. Inside, the result is the Coons value, checked against the formula written out.
- **Continuity** across u = 0, v = 0 and the cell borders, with responses on the shared edges.
- **The cause, reproduced:**
  - a model with a −0.82 span on the top edge and a knot of −4 at u = 1/3;
  - today's formula moves the point the wrong way at (28, −35);
  - the new one gives a value between the corrected top-edge position and the bottom edge.
- **The existing evaluate, correct and playback tests:** unchanged results on edges and views.

**bowen's 161.json:**
- at (28, −35) the left eye's lines do not cross;
- the 12 edges and every corrected angle are unchanged;
- each eye point's move between the two formulas is listed.

**Screenshots:** 161.json at (28, −35), before and after.
