# The one slider: why it took three code commits

Three-strikes rule (bowen 1791652114). Commits `c134ca8` (feature), `d6b1f35` (fixes after dot 1791771773, 1791771918, 1791771994, 1791772095, 1791772141), and the module's own window-blur ending that follows this note (dot 1791772430).

## Defects

1. **A run's applied move dropped at the end** (`d6b1f35`). `move/` ends a run whose raw offset is zero as a cancel. The slider takes only accepted steps, so with ↑ refused and ↓ taken the raw offset is zero while the value moved; the end threw it away. I reused `move/`'s ending without checking it against a target whose result is not its raw offset.
2. **Input-method keys acted** (`d6b1f35`): Enter, Esc and ↑ while composing committed, cancelled or stepped the field.
3. **A new slot id outside the old rules** (`d6b1f35`): the thumb run took `SLIDER_KEYS`, but blur, ⌘Z, the Undo / Redo buttons, the input method, focus into a field and a layer change were all written as `id === KEYS`. I added an id and did not grep where the old one decides things.
4. **The release took the last preview, not the release point** (`d6b1f35`): pressed at 40, dragged to 80, released back at 40 with no move there, 80 was written.
5. **Its own write taken for an outside change** (`d6b1f35`): the field ended by its own bar's press wrote 25, and the new slide saw 25 as someone else's change and cancelled itself.
6. **Outside changes missed before any preview** (`d6b1f35`): the check compared against the last preview only, so invalid text alone, a thumb pressed and not moved, or only refused steps let an outside change through — and a late release could write over it. Then (dot 1791772141) the start was exempted for good, which missed "previewed 10 → 11, set back to 10 from outside".
7. **Two inputs at once** (`d6b1f35`): typing + Enter in its own field during its own slide was written.
8. **The module itself did not end a thumb run on window blur** (this commit): the bench did, through its slot; the module alone kept the run and wrote on the late key up.

## Why it happened

The plan named the rules (one session at a time, one write through its own ending, outside changes cancel), but I coded each rule against **the cases I had in mind**, not against **every event in every session state**. The defects are the missing cells of one table: events (keydown, repeat, keyup, composition, blur of the window and of the element, pointer down / move / up / cancel, a second pointer, `value` / `identity` / `version` changes, unmount, an app cancel) × states (idle, field open with or without a valid text, a slide pressed / moved / back at its start, a thumb run with taken / only refused steps, after the slider's own write). 1 and 4 are an ending decided by stale or borrowed data; 5 and 6 are "outside change" defined by a proxy (the last preview) instead of by what the session expects; 3 and 8 are a rule kept in one place (the bench) and not in the thing that owns the session. It repeats the autosave lesson (`docs/autosave-problems.md`: a case table from every state, not from the mechanism being fixed) and the selection box's (`docs/selection-box-problems.md` rule 1: keep inputs, decide from them at the moment).

## What changes

1. A component that owns sessions gets, in its plan, the **events × states table** above, one test per cell that has an effect; the hand-in lists the cells.
2. **The session's owner decides its ending** from the current inputs at that moment (the release point, the applied value) — a borrowed ending (`move/`'s zero = cancel) is checked against the target first.
3. **Before adding an id, a kind or a source**, grep every place the existing ones decide something and list them in the hand-in.
4. Rules about a session (blur, outside change, one input at a time) live **in the module that owns the session**; the app may repeat them, and a repeat must be idempotent.
