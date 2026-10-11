# Stage 3b, package 5: why it took three code commits

Asked by dot 1791697875 (three-strikes rule, bowen 1791652114). Code `e2a7496`, fixed by `f1ed222` and `1420d46`; the visibility rule consolidated with this summary.

## 1. Why the gate let the log run first (`f1ed222`, dot 1791697642)

- **What I wrote:** the gate was added inside the existing logging proxy, after its first statement, `calls.push(... a.map(short) ...)`. `short` calls `JSON.stringify`, which throws on a circular argument. A callback could catch that throw before the forbidden call was recorded, then call `correct`, and the edit passed the gate.
- **Why I missed it:** I added to existing code at the end instead of deciding where the guard goes. The package 3 rule (`docs/stage3b-pkg3-problems.md` §3: list every throw of every function on the path) was applied to core's operations, not to the bench's own wrapper, so a throw before the guard was never listed.

## 2. Why the drawing's version was bound only from the press (`f1ed222`, dot 1791697642)

- **What I wrote:** the press bound `core` and `save(core)` as they were at the press, and the release compared with that. But the user decides from the frame on screen, drawn earlier. If another App changed the shared drawing between that frame and the press, picking read the old frame while the binding took the new drawing, and the release check could not see the mismatch.
- **Why I missed it:** I modelled the gesture's inputs (what it writes to) and not the display's input (what the user saw). The invariant is "the drag starts from what is shown", so it is established when the frame is drawn, not when the press arrives.

## 3. Why picking and the ghost used two visibility scopes (`1420d46`, dot 1791697776)

- **What I wrote:** picking filtered points by visible lines; the ghost drew every line ending at the dragged point, copied from the editing ghost, which has no visibility filter. A hidden neighbour showed as a blue ghost.
- **Why I missed it:** the same rule was written in two (then three) places: picking, the pickable-point marks, the ghost. This is package 2's lesson again ("keep one validator shared by every entry"), at the level of a UI rule.
- **Consolidated now:** one set per frame, `shownLines` / `shownEnds`, used by picking, the point marks and the ghost; removing its filter fails both the picking and the ghost tests.

## What changes

1. **Guards go first in a wrapper.** When adding a check to existing code, list each statement before it and whether it can throw; the check is placed before all of them, and anything that only reports (a log) is made unable to throw.
2. **A gesture binds what was shown.** Everything a gesture relies on (the drawing, the pose, what is picked) is taken from the frame's inputs, recorded when the frame is drawn, and checked at the press and at the release.
3. **One rule, one definition.** A rule used by more than one part (picking, marks, previews, commits) is computed once and shared; before hand-in, grep for the rule's condition (here `state.visible`) and expect one definition per use site group.
