# Selection box (2b): why it took four code commits

Three-strikes rule (bowen 1791652114). Commits `bb99291` (feature), `930ddd1` (fixes after dot 1791737043, 1791737260), the hover fix `b77d6dc` (dot 1791737542, 1791737579) and its follow-up for the pointer's place after a drag (dot 1791737940). Accepted on source and automated tests at dot 1791737579; the hover fix is non-blocking.

## Defects

1. **The hover asked another question than the press** (`930ddd1`). The press went: A's point / handle → box handle → the tool's pick → inside → marquee; the hover asked only the box (`hitBox`). The plan said "one function gives the order for pressing, for the hover cursor and for drawing the hot handle" (§2) — and I wrote two. The hover also ignored Shift / Option, which change the press's answer inside the box.
2. **The ghost drew the lines, not the joins' arcs** (`930ddd1`). Core's preview returns lines and arcs; I copied the lines only, so a curve with an arc join showed its arc only after the release. The plan's "preview equals commit" covered every drawn part; I checked it against the lines.
3. **Two boxes** (`930ddd1`). The bench already drew a dashed outline from the selected end points (bowen 1791558186). The new box drew a second, with another extent; I did not look for an existing drawing of the same thing.
4. **The hot handle went stale** (`b77d6dc`). `hot` was a value stored when the pointer moved; a tool change, a view change, a selection change or a pan / zoom changes what a press there would do without a move, and the stored value stayed.
5. **The resting pointer was kept only on moves without a button** (4th commit, dot 1791737940). A right- or middle-button pan started on a corner ended with the pointer elsewhere, and the hover was asked at the place before the drag. I stored the input (rule 1 below) but only on some of the events that move it.

## Why it happened

1, 2 and 4 are one mistake: **a derived display state kept apart from what it derives from.** The hover kept its own hit rule (1), the ghost its own list of parts (2), the hot handle its own stored answer (4). Each matched its source when written and drifted as soon as the source had more cases. 3 is a search I did not make: a new drawing of the selection, without first grepping how the selection is already drawn.

## What changes

1. (5 adds: an input is kept on **every** event that changes it — moves with or without a button, the release — and only the *asking* is gated.) Display state that answers "what would happen here" is computed by the very function that acts, from the current inputs, on each render — never stored as an answer. Only the inputs are stored: here the pointer in **screen** coordinates (so a pan or zoom maps it anew, dot 1791737579) and its modifiers.
2. A preview of core's result draws every kind core returns (lines, arcs; fills where they move), checked by a test comparing each kind with the committed result.
3. Before drawing a new mark for an existing thing (the selection, a pick), grep the bench for how it is drawn now, and replace or merge — never add beside.
