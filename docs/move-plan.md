# Moving: one input module for mouse and keyboard — rules before code (package 1 of 2)

Asked by bowen 1791733125: after a selection, a box that scales, rotates and stretches width or height alone; the whole selection grabbed anywhere in the box; arrow keys move it, Shift fast, Ctrl slow; everything the mouse can drag the keyboard can move; "moving should be independent, not part of editing — the background picture needs it too". dot 1791733234 agrees: one move module for the input, each target writing its own object.

**Two packages:** (1, this plan) the move module and the keyboard, wired to the selection and to the background picture; (2, its own plan after this one is accepted) the selection box — grabbing inside it, and its scale / rotate / width / height handles. The core's transforms (`translate`, `rotate`, `scale(sx, sy)`) exist already and are not rewritten (dot 1791733234).

## 1. The module, `move/`

- **What it does:** turns input into a displacement for one *session*: a mouse drag (press → moves → release) or a keyboard run (arrow keys pressed and held, released). It owns only the input's timing and amounts: start, preview, commit, cancel, and the step sizes. It knows nothing of lines or pictures and imports nothing.
- **A target** is what a caller hands it: `begin() → boolean` (may refuse: nothing to move, locked, a mode that writes nothing), `preview(offset)`, `commit(offset)` (one write, one undo step), `cancel()`. What moves, whether it may, and how it is undone stay with the target (dot 1791733234).
- **Mouse:** the offset is the pointer's displacement since the press; commit on release, nothing committed for a release where it was pressed.
- **Keyboard:** an arrow key starts a session (if none runs) and adds a step in its direction; a held key's repeats add more; other arrows join the same session. **Steps:** 1 drawing unit; **Shift** ×10; **Ctrl** ×0.1 (bowen). The session commits **once**, when the last arrow is released — so holding an arrow is one undoable move (dot 1791733234).
- **One session at a time:** while a mouse drag runs, arrow keys are ignored; while an arrow session runs, a press of the canvas is ignored (as a second pointer is). **Esc** cancels the running session (the target's `cancel`: nothing written); leaving the window commits a keyboard session (its moves were shown) and cancels a drag (as today). The bench gives a session its one gesture slot, so a tool change, playback, Open and unmount end it through the one cancel path.

## 2. Wiring

- **The selection (A / V):** interaction's drag of the selection becomes a `move/` session, and interaction takes arrow keys for the selection through the same session: the target's `begin` takes the scoped selection's units, `preview` shows the ghost (as today's drag preview), `commit` is one `translate(dx, dy, units)`. Arrow keys move the selection only with A or V and a selection; otherwise they do what they do now (nothing on the canvas).
- **The background picture (Move picture on):** today's drag and arrow keys become `move/` sessions with a target that previews the picture and commits one `setReference(id, { x, y })`; held arrows become one undo step (today each press is one). Its binding to the picture as drawn and its checks stay as they are (`RefBind`, §8a).
- **Boundary — a decision for dot:** interaction may import only core's package root (interaction test 2). Proposed: allow `move/` too — it imports nothing and knows nothing of core, so interaction still depends on no other app part. The alternative, the bench owning the selection's drag and keys, would move a decided part of interaction out of it; not proposed.

## 3. A question for bowen

On a Mac, **Ctrl + ← / →** switches desktops (a system shortcut), so the browser may never see those keys. Proposed: Ctrl + arrow as asked, and **Alt (Option) + arrow** as the same slow step, so it works on every Mac. (Shift fast is unaffected.)

## Not now

- The selection box and its handles (package 2); moving a point or handle alone by keyboard beyond what the selection holds; snapping.

## Tests

- Package: a drag gives the pointer's displacement, commits once on release, none for no movement; arrows: steps 1 / 10 / 0.1, repeats add, two arrows join, one commit on the last release; Esc cancels (target cancel, no commit); blur commits a keyboard run and cancels a drag; a refused `begin` starts nothing; one session at a time (keys during a drag ignored, a press during a key run ignored).
- Interaction: arrows with A / V move the selection: one `translate` per held run, one undo step; Shift / Ctrl / Alt steps; arrows with no selection or another tool change nothing; the drag still works as today (its existing tests unchanged).
- Bench: Move picture — a held arrow is one undo step, Shift / Ctrl steps, Esc cancels; a canvas press during a key run is ignored; a tool change / playback during a key run cancels it; the boundary test allows `move/` and nothing else. Feature-off: with the picture's keys not routed through the session, the one-undo test fails.
