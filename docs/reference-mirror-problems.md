# Reference mirror: why it took three code commits

Three-strikes rule (bowen 1791652114). Commits `6bd30e3` (feature), `36ab5cc`, `0708832` (fixes after dot 1791717672, 1791717696).

## Defects — both repeat a recorded lesson

1. **Mirror ended the panel preview but not a running picture drag** (`36ab5cc`). The plan listed "a preview still open ends first", and I treated the picture drag's ghost as just another preview. It is a gesture with its own window listeners, and the bench already has one way to end any gesture (`gesture.current.cancel`) that tool changes and playback use. Repeats `docs/stage3b-pkg5-problems.md`: every action that changes the document while a gesture can run goes through the one cancel path.
2. **The button named the picture by id only** (`0708832`). It read the module's current drawing at click time, so an old button could act on a same-id picture of another drawing. Repeats `docs/stage3b-pkg5-problems.md` §2 ("a gesture binds the frame's inputs") and `docs/reference-images-problems.md` item 6 ("keyed by the drawing and the source, never by id alone"). The panel's fields and the drag were already bound (`RefBind`); the new button was not.

## Why it happened

I added a new entry point (a button) and checked it against the preview rules in the plan, not against the existing list of entry points and the rules they already follow. The bench has three such rules for anything that writes a picture: bind to `{ core, gen, id, src }` at render, cancel a running gesture, end a panel preview. I applied one of three.

## What changes

1. A new write entry in the bench is checked against all three rules above before hand-in, and the hand-in lists each with its test.
2. Before adding any button that acts on an item of a list, grep how the neighbouring controls of that item bind it (here `RefBind`), and use the same binding.
