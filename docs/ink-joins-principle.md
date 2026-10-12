# Ink joins — the principle (bowen's distillation, 2026-10-12), for dot's review before any code

Replaces the per-piece patches of the first ink joins (P1 + arcs + smooth + the sharp scaffold, all behind the 墨迹轮廓 switch): those kept each line's round-capped ink and added pieces on top, which let a wide line's end show at a joint (the bulge and the half-disc, Slack 1791805745 figures ①②) and switched method at hard thresholds (③). Sources: bowen 1791807339 (the distillation), 1791807630 (free ends; the join stroke replaces the line), 1791808196 / 1791808359 / 1791808493 (binding is a join; pen and bind create it; old drawings), 1791809376 (B, C, D, E), 1791809660 (zone default; joins seen from either curve), 1791810585 (precedence; what is broadcast to the views), 1791810865 / 1791810907 (a join list per point, new joins on top); dot 1791807641 / 1791808553 / 1791808765 / 1791808988 / 1791809002 / 1791809495 / 1791809701 / 1791810630 / 1791810861; my restatements 1791807658 / 1791807685 / 1791808784 / 1791809462 / 1791810635 / 1791810889.

## 1. The principle

1. **A line's body has no end cap.** At an end it is cut flat, perpendicular to the centre line's direction there (the handle's direction); the cut's two corners lie half a width from the centre. The boundary at each end comes from one rule:
   - **a free end** — the end-stroke rule; until end strokes are designed (bowen 1791807630: later), today's round cap. An end at a point where no join exists is a free end.
   - **a joined end** — the join rule (§1.3) of the join that governs it (§2.3).
   - **an end that has no join of its own at a point where other lines are joined** (a line attached later to a fork) — it enters that joint's zone and is taken over by it: no end cap of its own, its width eases to the governing stroke's width at the joint inside the zone, and its ink merges with the joint's; it changes none of the joints there (bowen 1791809376 D, dot 1791809495).
2. **Every join has a transition zone**, and inside it **the join stroke replaces the lines' own ink** (nothing of the lines' ends is kept there). Outside the zones the lines' bodies are unchanged.
3. **Join rules.**
   - **Bound only (仅绑定), smooth, arc — a circle swept along the connected path.** The circle's diameter follows one width transition across the zone: from one line's width to the other's along one S-curve (smoothstep) centred on the joint (an arc: centred on the arc's midpoint), the average at the centre. Equal widths: no change. What is seen is the swept result — a thick circle may cover a thinner one nearby, a tight turn may overlap itself; that is the result, not a defect (dot 1791807641).
   - **Sharp (cusp) — the widths first transition to one width inside the zone, then F** (bowen 1791809376 B): the lines' bodies outside the zone are kept; inside it the boundary is rebuilt from the actual outer and inner edges (§3).
4. **The shape changes continuously** with the angle and the widths — no sudden switch of method at a threshold. Where the construction still switches, it is recorded as a known jump until replaced.
5. **Colour is separate**: it must not decide the ink's shape. Until the colour question is settled, the interim of the first version stays (a group drawn as one path when its lines share a paint; otherwise each line in its paint, arcs / tips in the base colour) — recorded, not part of the principle.

## 2. Joins in the core (a graph principle change, approved by bowen 1791808493 / 1791810907)

### 2.1 Binding is a join
Today "no join row" means 仅绑定 (src/joins/index.ts:1–3) and lines that only share a point are drawn separately. New:
- **'bound' is a join mode** beside smooth / cusp / arc, stored like them per pair of lines at a point. It constrains nothing in the shape (as 仅绑定 today); its effect is in the ink (merged, swept).
- **No join = only sharing the point.**
- **Created by what an operation means, never by counting line ends at a point** (dot 1791808988):
  - **pen continuing** from a free end: the new line and the line it continues get a 'bound' join (bowen 1791808359);
  - **bind of two free ends** (each point carried one line end and no join): the two lines get a 'bound' join (bowen 1791808493);
  - **split**: the two pieces of the split line get a 'bound' join at the new point — it continues the same line, without smooth's spring (dot 1791808988);
  - **copy / paste** keeps the copied joins (and their order) and creates none; **unbind** keeps a join whose two lines move together (it moves to the new point, as today) and drops a join it separates (src/joins/index.ts:179–186) — it creates none;
  - **created in the step that makes the connection** (inside the bind / the pen's new line / the split), not by comparing a point's line ends at the start and end of an edit (dot 1791809002);
  - **a later bind** onto a point that already carries two or more line ends creates no join and changes none there (bowen 1791808359).
- **Bind keeps the removed point's joins**: they move to the kept point, below the kept point's own joins (the kept point's existed there first) — replacing "a bind drops the removed point's joins" (dot 1791654260, src/joins/index.ts:163–169), so a later bind never breaks an existing setting (bowen 1791808359; Claude 1791810635, not objected to). Only existing pairs and their attributes move; lines without a join are not paired (dot 1791809115).

### 2.2 A join list per point (bowen 1791810865 / 1791810907)
- Each point has an **ordered list of its joins**, like a layer list: each entry is one pair of lines and its mode. A point with one join has a list of one.
- **Order = precedence** (§2.3). **A newly set join goes on top** (bowen 1791810907: a manual change overrides at once); a join created automatically (§2.1) is the point's first and only one when it is made, so it is on top too; joins moved by a bind go below the kept point's (§2.1). **bowen reorders by dragging.**
- The list replaces the canonical sort of the rows (src/joins/index.ts:35 — "the result never depends on the order joins were set"): the order is now explicit state, as the fill list is.
- **No hidden history, no automatic / manual flag**: the list's order is the whole record (dot 1791810861).

### 2.3 Precedence when joins share a line end
- A line end may be in several joins at its point (e.g. a fork a, b, c: a–b bound, later a–c set to smooth — bowen 1791810585). **All of them merge the ink**; **the topmost join containing the end governs that end** — its transition zone and its join rule decide the end's boundary and width.
- **Generation follows the list top-down, and a lower join never redraws what a higher one fixed** (dot 1791811126 — not "every join built whole, then a union": with a–b at widths 4 / 8 under a–c at 4 / 12, a–c makes a's width 8 at the joint where a–b alone would make it 6; a–b must not draw a's old transition back). Proposed rule: joins are processed from the top; a join shapes only the ends it governs; an end already governed by a higher join is a fixed boundary for it — its width and edges at the joint are what the higher join made them, and the lower join eases its own governed end to meet them (in the example, b eases from 8 to a's 8: no change). A join that governs no end of its own only merges the ink. A later-attached end with no join (§1.1) is taken over by the topmost join at the point, easing to that join's width at the joint. To be written in full before J2's generation (dot 1791811126).
- Lines at the point without a join between them are nothing to each other; an end with no join there is taken over as in §1.1.
- **Precedence reaches the shape too, for arcs** (Claude 1791811062): derived trims a line end for every arc at it — the largest radius there (src/derived/index.ts:61–66) — whatever the order. The line's trim and the arc's drawn part are decided together (dot 1791811126): proposed — **an arc takes effect only when it governs both its ends**; then it trims both and is drawn whole; otherwise it trims neither, is not drawn, and acts as a 'bound' join under the joins above it. Smooth's spring and cusp put no trim on the shape, so they need no such rule. With the generation rules, before J2.

### 2.4 What is broadcast to the views (bowen 1791810585)
- **Broadcast to every view:** the pairs, their modes and the list's order.
- **Per view (adjusting changes only the current view):** a join's transition-zone length and an arc's radius. A new join gets defaults in the other views: the zone's automatic length (§4), an arc's radius copied as today (src/joins/index.ts:55–60).

### 2.5 Seen from either curve (bowen 1791809660, dot 1791809701)
- A join's attributes are stored once, on the join; selecting either of its curves shows and edits the same join. At a point with more than one join the panel names the pair ("曲线 A ↔ 曲线 B") — selecting another curve never edits a different pair silently. A line's two ends are listed separately.

### 2.6 Old drawings
- A new archive version; opening the previous version adds a 'bound' join at every point with exactly two line ends and no join; forks get none. Gated on the version, so a drawing saved in the new format never gains joins on reopening. The archive refuses older versions without migration (src/archive/index.ts:8–14) — a second, approved exception, for the previous version only.

Unchanged: smooth's spring, arc's trims and fillet, cusp's freedom in the shape; joins dropped when their lines no longer meet at the point (existing pruning); undo / redo.

## 3. Sharp joins

- **Widths first** (bowen 1791809376 B): inside the zone the two widths transition to one width (the same S-curve as §1.3), then F.
- **F** (docs/sharp-join-F.md) as the geometric idea (dot 1791806880): each line flat-ended at p; the two outer edges extended along their **actual** edge directions at p to meet at M (the tip), the inner edges meeting at Q; only the outermost outline kept. With the S-curve the width is still changing at p, so the edges there are not parallel to the centre lines; and equal widths at p do not by themselves rule out every crossing of the edges inside the zone (dot 1791808765) — the handling the sheets added around F (trimming or narrowing an exposed inner corner, I2b) stays a candidate, used only where a delivered picture shows it is needed.
- **Open for bowen:** the end at a 0° fold-back — with L(0) = 0 and both lines flat-ended at p it is a square end (v103 pinched it to zero width); square, round or pinched (Claude 1791811062).
- **The tip's overhang is a function of the angle** (bowen 1791809376 C): overhang = the tip's length beyond the line body (dot 1791809495). Its natural value already falls to 0 at 180°; it is capped by L(θ) = 5 × the average full width × smoothstep(θ / 30°) — 0 at 0°, the full 5× from 30° (30° is bowen's example, adjustable). Overhang = min(natural, L(θ)). **Goal, not shown yet** (dot 1791811126): the whole joint changing continuously with the angle — the tip's sides, the inner side and what remains at 0° follow the same rules as the tip shrinks, never falling back to the old pinch; delivered as pictures over an ordinary sweep of angles, not as a proof. The shortened tip's style (straight sides as v103, curved as the sheets) is bowen's to choose.

## 4. The transition zone

- **Desired length** Z for widths W ≥ w: **W² / w** as the default (bowen 1791809660; adjustable). Figure E (Slack F0C8K0V9BV0) compares it with √(W² + w²) and with a fixed steepness max(W, k × (W − w)) (dot 1791809495).
- **Automatic / manual** (dot 1791809701): automatic recomputes Z from the two widths; manual keeps the value set by hand (per view, §2.4); the panel shows the length actually used after the limits below.
- **Placement:** total length Z, centred on the joint (Z/2 on each side). On an arc of length A, centred on the arc's midpoint: Z ≤ A — the transition covers the middle Z of the arc (the arc's two outer parts keep their line's width); Z > A — the whole arc and (Z − A)/2 of each line (dot 1791809115).
- **Limited by the available length, both ends of a line together** (dot 1791807641): each side's half-zone is at most a third of the line's length, so a line's two zones never overlap; the transition stays centred (both sides shortened to the shorter half).
- Width at a zone's boundary = the line's own width there (with later width profiles / tapers: the profile's width at that point).

## 5. Packages (one at a time, each accepted by dot)

1. **J1 — joins in the core (list and storage; dot 1791811126 cleared it to start):** the 'bound' mode; creation by operation (§2.1); the join list per point with its order (§2.2) and precedence read from it (§2.3),  bind moving the removed point's joins; per-view zone length beside the radius (§2.4); the archive version and its migration. Flows: pen chains, split, bind onto a free end / onto a fork / of a point carrying a pair, unbind, undo / redo, copy / paste, save / reopen (old file → joins added; new file → never), multi-view (modes and order everywhere, zone / radius per view).
2. **J1b — the join list in the bench:** the panel for a selected curve (its two ends, each end's joins named "A ↔ B", mode, zone automatic / manual and the length used, radius), the list per point with drag to reorder, the Join tool offering 'bound'.
3. **J2 — swept joins in the ink:** groups through joins; bound / smooth / arc as one sweep along the connected path with the zone's S-curve; ends governed per §2.3; later-attached ends taken over (§1.1); free ends round; the current smooth easing (each side to the average, flat at p) replaced. Flows: equal and unequal widths, a chain with joins at both ends of a short line, an arc, a fork (a–b bound, c attached, a–c set smooth, reorder), hide a line, width / radius edits, undo.
4. **J3 — sharp joins:** widths first, F from the actual edges, the tip's overhang L(θ); pictures against the sheets' cases; remaining jumps recorded.

Tests: ordinary cases and everyday operations only (bowen 1791801468); the real-drawing checks on 5199 with images (dot 1791783670).
