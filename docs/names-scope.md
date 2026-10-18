# Name scope: 图层·连续曲线·线 (bowen 1792308208, 1792308474)

A line's true name is 「图层·连续曲线·线」; two names may share any two parts. This replaces the rule "inside one layer,
line names and continuous-curve names share one occupancy check" (docs/step5-names-meta.md).

## Rules
1. Layer names: unique among layers (unchanged).
2. Curve (连续曲线) names: unique among the curves of their layer; never empty.
3. Line names: unique among the lines of their curve; never empty. A line name never collides with a curve name.
4. Defaults stay as they were: 「曲线N」 / 「连续曲线N」 with the smallest N free in the layer (so joining curves rarely
   brings two default names together).
5. Rename: a line's name must be free in its curve; a curve's among its layer's curves.
6. **New (flag for bowen):** a topology step that puts two lines of one name into one curve (two curves joined): the line
   earlier in the curve's order keeps the name, the other becomes 「<name>副本」 (then 副本2, …), free in that curve.
7. Paste / layer copy (unchanged in spirit): a copied line keeps its name if free in its new curve, else 副本; a copied
   curve keeps its name if free among its layer's curves, else 副本.
8. A curve moved to another layer keeping ids: its name free among the target's curves, else 副本; its lines keep theirs.
0. 「·」 is in no name — layer, curve or line: refused when made or renamed; removed when a file is opened or an older
   clipboard pasted; only a name it changed is given 副本 where it now repeats another (dot 1792309259, 1792309343).
9. Standards (骨骼标准): a standard bone stores 「连续曲线·线」 as its name — names never contain 「·」 (bowen 1792308620:
   rename refuses it; names saved before have it removed on open, bowen 1792308685, a collision that makes gets 副本), so
   the joined form is unambiguous; such a standard is marked `naming: 'curve·line'`. Pairing (once, at 用标准) by it. A
   standard without the marker was saved before: its bones hold line names (「·」 removed on reading) and pair by the
   bone's line name when exactly one bone of the layer has it, else stay unpaired — the marker decides, never a 「·」 in a
   name (dot 1792309220). Stored keys and pairs are untouched.
10. Archive: the names part keeps its shape (old files are valid under the wider rule, after 「·」 is removed); standards
    keep theirs (v15).

## Tests
Same line name in two curves of a layer; rename refused only within a curve; a curve name equal to a line name; join of
two curves with same-named lines (rule 6) and undo; paste and layer copy into a curve holding the name; moveGroup; save /
open; standards: pairing by curve + line, a line name repeated across curves, an old standard bone without curve
(unique → paired, repeated → unpaired), keys and pairs kept through renaming a curve, a split and a copy.
