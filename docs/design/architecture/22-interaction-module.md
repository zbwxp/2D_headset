# 22 — The interaction module: plan (before code)

bowen 1791543087: write the graph rows; write a plan before code. Interaction is an independent module, and where a function's package is unclear, it is discussed.

Graph section "Interaction" (design `1e0d9cf`):
1. **One owner per state.** The drawing, the selection and the undo history belong to core. The current tool and every unfinished operation belong to interaction.
2. **Cancellable, atomic commit.** A preview never writes.
3. **Explicit targets.**

Earlier frame (doc 21 §0, bowen 1791477975): parts with a graph are never polluted, and the rest is a throwaway bench. Interaction now has a graph, so it leaves the bench and becomes a module held to those rules.

## 1. Packages

| Package | Has a graph | Owns | Does | Never does |
|---|---|---|---|---|
| `core` (exists) | yes | the drawing, the selection, the undo history | every drawing rule; one edit = one commit; copy / clip, save / open | know about pointers, keys, screens, tools |
| `interaction` (new, `headset-core/interaction/`) | yes (this section) | the current tool; unfinished operations (drag, pending cut, two-click first pick, pen chain, snap hint); the clipboard and its paste count | turns input events (in document coordinates) into core calls; keeps each unfinished operation's target fixed; ends unfinished state on commit, cancel, failure (by its rule), tool change and drawing change; describes previews and refusal marks as plain data | draw anything; hold a copy of the drawing; make any drawing rule; reach core except through its public interface |
| `view` (bench for now) | no | the camera | draws the drawing, plus interaction's preview / mark description; maps screen ↔ document | change any state |
| `app` (bench for now) | no | which drawing is open; panels; files | wires the parts together; file download / upload; buttons and panels | rules |

Boundary tests, as core already has:
- `interaction` imports only core's public entry.
- Core never imports `interaction`.
- `view` and `app` may import both, but not each other's insides.

## 2. What moves out of the bench into `interaction`

Each item goes in with its tests (scripted input → expected core calls / preview data, without a browser).

**Tools:**
- pen: chain of clicks; first pick held until the next one;
- V / A: select, and drag with a ghost;
- split, bind, merge position, link, unbind, join (two clicks, in click order), fill.

**Unfinished operations:**
- **drag:** start → move (preview offset) → release (one `core.edit`), or cancel (Esc, pointer cancel, lost capture);
- **pending cut:** mark → paste (a move) or cancel;
- **two-click pick:** first pick → second pick, or cancel.

**Lifecycle per the graph:**
- **Commit:** a commit ends the operation.
- **Cancel:** a cancel drops only what is not committed.
- **Failure:** the gesture ends, and a pending cut stays.
- **Drawing change:** opening or switching drawings ends everything tied to the old drawing.

**Clipboard:**
- copy replaces the clip and ends a pending cut;
- paste offsets each repeat by one step.

## 2b. The core operations interaction calls (public interface only; dot 1791543119)

| Interaction does | Core calls |
|---|---|
| **Reads** (for picking, previews, panels) | `snapshot()` and `geometry()` |
| | `pickLoop(at)` (fill) |
| | `canUndo` / `canRedo` |
| **Selects** (a pre-edit, one step) | `edit(e => e.select(units, mode))` |
| | `edit(e => e.selectGroup(line, mode))` |
| **Commits a drag** | `edit(e => e.translate(dx, dy))`, on the selection fixed at the drag's start |
| **Pen** | `edit(e => e.line(id, a, b))` |
| **Two-click tools** | `bind(keep, remove)` |
| | `mergePosition(target, moving)` |
| | `link(a, b)` |
| | `join(point, l1, l2, opts)` |
| | `removeJoin(…)` |
| **One-click tools** | `split(line, t, …)` |
| | `unbind(point, [line], id)` |
| | `fill(loop, colour)` / `clearFill(loop)` |
| **Keys** | `deleteSelection()` (Delete), with the selection |
| **Mirror apply / link** (a two-step pick) | `mirrorApply`, `mirrorLink` |
| **One-shot buttons** (rotate / scale / flip, lock / hide / width, unmirror) | none: they are `app` panels calling core directly (§3.5) |
| **Clipboard** | `copy(lines?)` → a clip it holds |
| | `edit(e => e.paste(clip, layer, offset, prefix))` |
| | pending cut, then `edit(e => { for (g) e.moveGroup(g, layer) })` |
| **History** | `undo()` / `redo()` (never inside an edit) |

**Not interaction's:**
- layer panel operations (`layer`, `renameLayer`, `reorderLayer`, `layerState`, `copyLayer`, `deleteLayer`): panels, in `app`;
- `save` / `open`: files, in `app`.

**Who owns what:**

| State | Owner | Why |
|---|---|---|
| The drawing | core | graph row "State has one owner" |
| The selection | core | graph row "State has one owner" |
| The undo history | core | graph row "State has one owner" |
| Current tool and tool options (join mode, arc radius, fill colour, width field) | interaction | belongs to the tool |
| Drag in progress (start, offset, target selection) | interaction | an unfinished operation |
| Pending cut (groups, drawing it belongs to) | interaction | an unfinished operation |
| Two-click first pick | interaction | an unfinished operation |
| Pen chain | interaction | an unfinished operation |
| Snap hint | interaction | an unfinished operation |
| Clipboard and its paste count | interaction | the clipboard is tied to copy / paste, which interaction drives |
| Camera (pan, zoom) | view | display only |
| Which drawing is open | app | not part of any drawing |
| Mirror "source" picked for apply / link (bench's Set source) | interaction | the first step of a two-step operation |

## 3. Placement: settled by Claude and dot from the graph and the boundaries (dot 1791543266)

bowen may overrule any of these. None needs a new principle.

1. **Hit testing.**
   - Distance from a document position to points, handles and curves is a read-only geometry query next to core.
   - Which kind the current tool picks, the tolerance and the order among candidates belong to interaction.
   - The mouse-selection rules stay out of core.
2. **Ids for new objects.**
   - Callers keep supplying ids, as now; this does not make them owners of identity rules.
   - `app` gives interaction an id generator (the bench's session-prefixed one).
   - No change to core's identity handling in this round.
3. **Refusals.**
   - Core returns who refused and why: a code and the objects involved.
   - Interaction decides how that is shown (red cross, lock or mirror mark).
   - Nobody parses error text.
   - This is a core interface addition, planned separately before interaction relies on it. Until then interaction shows the message as it is.
4. **Preview.** The rough ghost stays; this fits the graph, which does not fix how exact a preview is.
5. **One-shot panel commands** (lock a line, rotate, delete from a button, layer panel, files) stay in `app` and call core's public operations directly.
   - The temporary-state rules must not spread into the panels. `interaction` exposes the moments that end temporary state, and `app` only calls them:
     - `toolChanged(tool)`;
     - `drawingChanged(core)` (opened or switched);
     - `historyChanged()` (undo / redo from a button), which ends an in-progress drag and checks whether a pending cut's objects still exist;
     - `cancel()` (Esc).
   - The rules for each live in interaction.
6. **Clipboard.**
   - Copying and pasting content stays in core's `clipboard` module.
   - Interaction only holds which clip it has, the pending cut and the paste count.

## 4. Process

- Once bowen answers §3: write `interaction/` plan and acceptance list (commands and preview data per scripted input, the lifecycle cases above), then code. dot reviews.
- The bench keeps drawing and panels; its tool code is replaced by `interaction`.
