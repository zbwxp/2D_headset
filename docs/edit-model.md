# The edit model: intents, settling, protection

Why this note exists (bowen 1791475302): most review rounds on editing and apply were the same mistake. One edit can hold several operations (transform, split, apply, lock changes and so on), and an operation that worked alone broke when it was combined with another. The model below is what every operation must follow. The audit table checks each operation against it.

## 1. The model

1. **Draft.** An edit works on a private copy. Each operation changes the copy at once, so the next operation in the same edit sees the change. This covers topology, attributes and states.
2. **Intents.** Whatever depends on how the edit's constraints settle is recorded as an intent, not as a final value:
   - acted-on point targets (`Changes.targets`);
   - held handles (`held`);
   - aimed handle tips (`handleTips`, with the split factor);
   - locks copied by an apply (`appliedLocks`).
   A structural operation later in the same edit carries the intents with it: a split maps and scales them; a bind or delete drops intents whose element is gone.
3. **Reading.** An operation that computes something from geometry reads the edit so far *as settled*. Settling here covers point positions (endpoint links and mirror, averaged over the intents), aimed tips, mirrored handles and smooth springs. It is computed on a scratch copy. Settling for reading never changes topology (no auto-bind, no removal), so ids stay valid.
4. **Settle once.** At commit the fixed pipeline runs once over all intents:
   - isolated points;
   - the position loop (links and mirror averaged, then overlap binds);
   - aimed tips;
   - mirrored handles;
   - springs;
   - fills;
   - groups;
   - selection.
5. **Protection.** The lock check compares settled results:
   - a line locked at the end, and existing before, against the published state;
   - a line an apply locked, against the edit-so-far settled right after that apply;
   - an explicit lock change ends that baseline.

## 2. Audit: each operation against the model

Corrected after dot's reviews: unbind, copy-layer and the pen's default handles read geometry too. The audit is now by *function*, meaning every function that reads geometry to produce new geometry (dot 1791475660). Each such read is either part of settling, a pure output (derived), or uses the settled view. `network.aimHandle`'s provisional offset is recomputed from final positions at commit. The audit *locates* this class of problem; it does not claim that nothing else is left.

| Operation | Reads geometry | Records intents | Reads from (after the settled-view fix) |
|---|---|---|---|
| `move` | no | targets | — |
| `moveHandle` | no | held (replaces an aimed tip) | — |
| `transform` / `translate` / `rotate` / `scale` | positions, handles | targets, aimed tips | settled view |
| `flip` | the selection's centre | same as transform | settled view |
| `mergePosition` | the target point's position | target | settled view |
| `link` | the first point's position | target | settled view |
| `split` | the line's curve | maps and scales intents | settled view (the settled curve is cut) |
| `unbind` | the point's position, the moved line's handle direction | new points as targets | settled view |
| `copyLayer` | positions and handles of the copied lines | — | settled view |
| `mirrorApply` / `mirrorLink` | source and target controls | targets, held handles, applied locks | settled view |
| `line` (pen) | an existing end point's position, for default handles | — | settled view (dot 1791475660) |
| `bind` / `deleteLine` | no geometry | — | — |
| `lineState` / `fillState` / stroke / fill / join / end stroke | no | an explicit lock clears the applied-lock baseline | — |
| `select` / `selectGroup` | no | — | — |
| `deleteSelection` / `deleteLayer` / `moveGroup` | no geometry | as their parts | — |

**The settled view** (`document.view`) settles positions and handles on a scratch copy: links and mirror, aimed tips, mirrored handles, springs. It changes no topology (no auto-bind, no removal), so ids stay valid. It does not turn followed points into acted ones. It does not count old intents again. The reading operation writes back only what it changes itself.

**Regression tests:** `test/settled-reads.test.ts` S1–S7, one minimal case with an explicit expected result for each read site. Each fails on the code before the fix. A one-edit result is not required to equal two separate edits in general: two edits settle in between, including automatic binds (dot).

## 3. Tests: the operation × combination matrix

Fixture: two layers with an endpoint link, a mirror-linked pair, a locked line and a smooth join. For every ordered pair of operations (A then B) from move, moveHandle, transform, flip, mergePosition, link, split, bind, unbind, delete, mirrorApply and lineState, in one edit, the tests check:

1. Atomicity: the edit is either published whole or refused with nothing changed, and undo restores the state before it.
2. Determinism: the same edit always gives the same result.
3. Mirror: every stored pair is mirrored where no outside constraint differs between the two sides.
4. Locks: a line locked throughout is unchanged; an applied-lock target is unchanged after its apply.
5. Reading: an operation B that reads geometry sees the same values as reading the settled result of an edit that contained only A.
